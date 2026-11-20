"""Stage3 candidate calculation; never imports/runs the original engine or ranks listings."""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
from critic_core import fit_critic, rent_burden, quantile_linear, display_percentages


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_csv(path):
    with path.open(encoding='utf-8-sig',newline='') as f:
        reader=csv.DictReader(f)
        rows=list(reader)
    if any(None in r or any(v is None for v in r.values()) for r in rows):
        raise ValueError('Malformed CSV: '+str(path))
    ids=[r['매물번호'] for r in rows]
    if len(ids)!=len(set(ids)) or any(not x for x in ids):
        raise ValueError('Invalid listing IDs')
    return rows


def numeric(s):
    if s is None or not str(s).strip():
        return None
    n=float(s)
    if not math.isfinite(n):
        raise ValueError('Nonfinite numeric input')
    return n


def coordinate_valid(r):
    a,b=numeric(r['위도']),numeric(r['경도'])
    return a is not None and b is not None and -90<=a<=90 and -180<=b<=180


def main(source, output):
    source,output=source.resolve(),output.resolve()
    baseline=source/'baseline-stage1'
    if output==baseline or output in baseline.parents or baseline in output.parents:
        raise ValueError('Output must be outside the protected baseline hierarchy')
    manifest=json.loads((source/'scoring-baseline-manifest.json').read_text(encoding='utf-8'))
    source_states=[]
    for entry in manifest['files']:
        path=baseline/Path(entry['snapshot']).name
        if digest(path.read_bytes())!=entry['sha256']:
            raise ValueError('Snapshot hash mismatch: '+str(path))
        live=Path(entry['source'])
        source_states.append(dict(file=entry['source'],snapshotHash=entry['sha256'],
                                  liveHashAtStart=digest(live.read_bytes())))
    rules_path=source/'scoring-stage2-rules.json'
    rules_bytes=rules_path.read_bytes()
    rules=json.loads(rules_bytes)
    config=json.loads((baseline/'점수_v2_config.json').read_text(encoding='utf-8'))
    categories=rules['scope']['categories']
    if config['budget'] is not None or config['want'] is not None or rules['budget']['main']['value']!=300:
        raise ValueError('Unexpected baseline or agreed budget')
    base=read_csv(baseline/'대구_구역별_매물 (최종).csv')
    scores=read_csv(baseline/'점수_v2.csv')
    by_id={r['매물번호']:r for r in base}
    if set(by_id)!=set(r['매물번호'] for r in scores):
        raise ValueError('Score/base join mismatch')
    reference=[r for r in scores if coordinate_valid(by_id[r['매물번호']])]
    if len(reference)!=rules['data']['cohort']['n']:
        raise ValueError('Reference cohort size differs')
    rent_totals={}
    management_known=set()
    missing_mgmt=0
    for r in base:
        k=r['매물번호']
        rent=numeric(r['월세'])
        management=numeric(r['관리비'])
        if rent is None or rent<0 or (management is not None and management<0):
            raise ValueError('Invalid raw rent/management: '+k)
        if management is None:
            missing_mgmt+=1
        else:
            management_known.add(k)
        rent_totals[k]=rent+(management if management is not None else 0.0)
    reference_amounts=[rent_totals[r['매물번호']] for r in reference]
    quantile_budgets={str(p):quantile_linear(reference_amounts,p) for p in [.25,.5,.75]}
    scenario_defs=[dict(id='budget_300',budget=300.0,role='main',managementKnownOnly=False),
                   dict(id='budget_none',budget=None,role='supplementary_no_budget',managementKnownOnly=False)]
    seen={300.0}
    for p,budget in quantile_budgets.items():
        if budget>0 and budget not in seen:
            scenario_defs.append(dict(id='budget_quantile_'+p.replace('.','_'),budget=budget,
                                      role='supplementary_budget',managementKnownOnly=False))
            seen.add(budget)
    scenario_defs.append(dict(id='budget_300_management_known',budget=300.0,
                              role='supplementary_management_recorded',managementKnownOnly=True))
    output_data=dict(stage=3,status='candidate_calculation_complete_not_applied',
                     userAuthorization='맞으면 3단계로 진행해',
                     method='CRITIC fixed-score adaptation; sample-minmax comparison separately',
                     sourceDirectory=str(source),rulesSha256=digest(rules_bytes),
                     baselineVersion=config['version'],referenceN=len(reference),listingN=len(base),
                     groupWeightsFrozen={c:config['preset'][c]['g'] for c in categories},
                     factorOrder=config['factors'],categories=categories,cohorts={},results=[],
                     scenarios=scenario_defs,quantileBudgets=quantile_budgets,
                     managementMissingFullSourceN=missing_mgmt,
                     managementMissingReferenceN=sum(r['매물번호'] not in management_known for r in reference),
                     sourceStates=source_states,stage4Started=False,productionApplied=False,
                     originalEngineExecuted=False,rankingComputed=False,bootstrapComputed=False)
    output_data['derivedRentBurden']={str(budget):{r['매물번호']:(None if rent_burden(rent_totals[r['매물번호']],budget) is None else round(rent_burden(rent_totals[r['매물번호']],budget),1)) for r in reference} for budget in sorted({s['budget'] for s in scenario_defs if s['budget'] is not None})}
    shared={'가성비':'가성비','보증금':'보증금점수','건물연식':'건물연식'}
    records={}
    def run_group(category,group,scenario):
        configured=config['factors'][group]
        exclusions={}
        for f in configured:
            if f=='층' and config['preset'][category]['floor'] is None:
                exclusions[f]='disabled_by_baseline_config'
            elif f=='임대료부담' and scenario['budget'] is None:
                exclusions[f]='budget_not_entered'
        active=[f for f in configured if f not in exclusions]
        prior=[config['preset'][category]['s'][group][configured.index(f)] for f in active]
        fitting=[]
        excluded_affordability=0
        excluded_management=0
        for row in reference:
            k=row['매물번호']
            if group=='비용' and scenario['managementKnownOnly'] and k not in management_known:
                excluded_management+=1
                continue
            if group=='비용' and scenario['budget'] is not None and rent_totals[k]>scenario['budget']:
                excluded_affordability+=1
                continue
            d={'id':k}
            for f in active:
                if f=='임대료부담':
                    raw=rent_burden(rent_totals[k],scenario['budget'])
                    d[f]=None if raw is None else round(raw,1)
                else:
                    d[f]=numeric(row[shared.get(f,f+'_'+category)])
            fitting.append(d)
        for norm in ['fixed_score','sample_minmax']:
            fit=fit_critic(fitting,active,prior,normalization=norm)
            ids=fit.pop('completeCaseIds')
            ids_hash=digest(('\n'.join(ids)+'\n').encode('utf-8'))
            output_data['cohorts'].setdefault(ids_hash,dict(n=len(ids),listingIds=ids))
            fit.update(category=category,group=group,scenario=scenario['id'],
                       referenceN=len(reference),structuralExclusions=exclusions,
                       configuredFactors=configured,cohortSha256=ids_hash,
                       excludedByAffordabilityN=excluded_affordability,
                       excludedByMissingManagementN=excluded_management,
                       originalNominalShares=dict(zip(configured,config['preset'][category]['s'][group])),
                       groupWeight=config['preset'][category]['g'][config['groups'].index(group)])
            for field in ['candidateWeights','originalWeights','equalWeights','fallbackWeights']:
                fit[field+'Display']=display_percentages(fit[field])
            if fit['candidateWeights'] is not None:
                fit['displayRoundingAdjustmentPp']={f:fit['candidateWeightsDisplay'][f]-round(fit['candidateWeights'][f],1) for f in active}
            output_data['results'].append(fit)
            records[(category,group,scenario['id'],norm)]=fit
    for c in categories:
        for g in config['groups']:
            if g=='비용':
                for scenario in scenario_defs:
                    run_group(c,g,scenario)
            else:
                run_group(c,g,dict(id='reference_default_area',budget=None,managementKnownOnly=False))
    main_rows=[]
    for c in categories:
        item={'category':c,'groups':{}}
        for g in config['groups']:
            sid='budget_300' if g=='비용' else 'reference_default_area'
            primary=records[(c,g,sid,'fixed_score')]
            secondary=records[(c,g,sid,'sample_minmax')]
            w=primary['candidateWeights']
            if w is None:
                raise ValueError('Main candidate unestimable: '+c+'/'+g)
            item['groups'][g]=dict(factors=primary['factors'],n=primary['completeCaseN'],
                                   candidate=w,display=primary['candidateWeightsDisplay'],
                                   original=primary['originalWeights'],originalDisplay=primary['originalWeightsDisplay'],
                                   sampleMinmax=secondary['candidateWeights'],sampleMinmaxDisplay=secondary['candidateWeightsDisplay'],
                                   status=primary['status'],exclusions=primary['structuralExclusions'])
        main_rows.append(item)
    output_data['mainSummary']=main_rows
    checks=dict(referenceN=len(reference)==2669,totalResultRecords=len(output_data['results']),
                allMainGroups=len(main_rows)*len(config['groups'])==32,
                allCandidateSumsValid=all(r['candidateWeights'] is None or (abs(sum(r['candidateWeights'].values())-100)<1e-9 and all(0<=v<=100 for v in r['candidateWeights'].values())) for r in output_data['results']),
                allDisplaysSumTo100=all(r['candidateWeightsDisplay'] is None or round(sum(r['candidateWeightsDisplay'].values())*10)==1000 for r in output_data['results']),
                twoFactorIdentity=True,costIdenticalAcrossCategories=True,
                expectedNoncostSampleSizes=True)
    for r in output_data['results']:
        if r['status']=='two_factor_sd_ratio':
            live=r['informationFactors']
            for f in live:
                expected=100*r['normalizedSD'][f]/sum(r['normalizedSD'][k] for k in live)
                if abs(expected-r['candidateWeights'][f])>1e-8: checks['twoFactorIdentity']=False
        if r['group']!='비용':
            expected=2649 if r['group']=='공간' and r['category']=='공연문화' else 2623 if r['group']=='공간' else 2669 if r['group']=='입지' else 2531
            if r['completeCaseN']!=expected: checks['expectedNoncostSampleSizes']=False
    for scenario in scenario_defs:
        for norm in ['fixed_score','sample_minmax']:
            ws=[records[(c,'비용',scenario['id'],norm)]['candidateWeights'] for c in categories]
            if any(w!=ws[0] for w in ws): checks['costIdenticalAcrossCategories']=False
    for state in source_states:
        state['liveHashAtEnd']=digest(Path(state['file']).read_bytes())
    checks['originalInputsUnchangedDuringRun']=all(s['liveHashAtStart']==s['liveHashAtEnd'] for s in source_states)
    if not all(v for k,v in checks.items() if k!='totalResultRecords'):
        raise ValueError('Calculation validation failed: '+repr(checks))
    output_data['validation']=checks
    output.mkdir(parents=True,exist_ok=True)
    (output/'scoring-stage3-results.json').write_text(json.dumps(output_data,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    lines=['대구 공실 스코어링 — 3단계 그룹 내부 비중 후보 계산 결과','기준일: 2026-11-19',
           '상태: 계산 완료 / 원본 프리셋·서비스 미적용 / 4단계 추천 순위·안정성 검증 미진행',
           '목적: 기존 인자 점수를 결합하는 통계적 비중 후보 산출. 실제 임차인 선호·최적 적합도 검증 결과가 아님.',
           '방법: 기존 0~100 점수/100을 이용한 CRITIC. 원 논문의 표본 min-max 전처리는 보조 후보로 분리.',
           '원문 objective weights는 목표가중치가 아니라 객관적·데이터 기반 가중치를 뜻함. CRITIC은 CRiteria Importance Through Intercriteria Correlation의 약자.',
           '비용 주 조건: 월세+관리비 상한 300만 원. 다른 그룹: 기준 집합 2,669건, 희망 면적 미입력.',
           '수치는 각 그룹 내부에서 합계 100%. 4개 그룹 사이 가중치가 아님. 대시는 의도적 인자 제외.',
           '', '1. 주 후보: 업종별 그룹 내부 비중 (%)',
           '순서: 비용=임대료부담/가성비/보증금; 공간=층/면적적합도/건물연식; 입지=교통/상권활성도/배후수요; 업종적합=용도일치도/건물용도',
           '업종 | 비용 | 공간 | 입지 | 업종적합']
    def vector(weights,configured):
        return '/'.join('—' if f not in weights else format(weights[f],'.1f') for f in configured)
    for row in main_rows:
        lines.append(row['category']+' | '+' | '.join(vector(row['groups'][g]['display'],config['factors'][g]) for g in config['groups']))
    lines.extend(['','2. 기존 실제 적용 비중과 비교 (구조적 제외 인자 비중을 빼고 정규화한 값)','업종 | 그룹 | 기존 | 주 후보 | 보조 min-max 후보 | 완전 관측 n | 상태'])
    for row in main_rows:
        for g,d in row['groups'].items():
            lines.append(' | '.join([row['category'],g,vector(d['originalDisplay'],config['factors'][g]),vector(d['display'],config['factors'][g]),vector(d['sampleMinmaxDisplay'],config['factors'][g]),str(d['n']),d['status']]))
    lines.extend(['','3. 예산별 비용 후보 (업종 공통 결과; 업종별로 같은 계산임을 검증)','예산 | 역할 | 인자 순서 | 주 후보 | 보조 min-max | n'])
    for scenario in scenario_defs:
        r=records[(categories[0],'비용',scenario['id'],'fixed_score')]
        mm=records[(categories[0],'비용',scenario['id'],'sample_minmax')]
        lines.append(' | '.join([str(scenario['budget']),scenario['role'],'/'.join(r['factors']),str(r['candidateWeightsDisplay']),str(mm['candidateWeightsDisplay']),str(r['completeCaseN'])]))
    lines.extend(['분위수 예산(만원): '+json.dumps(quantile_budgets,ensure_ascii=False),
                  '300만 원은 비교 설정이며 대표 임차인 예산으로 추정한 값이 아님. 예산 미입력 결과는 2인자 조건으로서 3인자 비중을 대체하지 않음.',
                  '관리비 기재 표본 결과는 표본 구성이 달라질 수 있어 정답으로 취급하지 않음.',
                  '', '4. 표본·예외 처리',
                  '원본 매물 '+str(len(base))+'건, 기준 좌표 집합 '+str(len(reference))+'건.',
                  '관리비 미기재: 전체 '+str(missing_mgmt)+'건 / 기준 집합 '+str(output_data['managementMissingReferenceN'])+'건. 기존 엔진대로 미기재 0 처리(이 값이 실제 0임을 확인한 뜻 아님).',
                  '일반 결측은 그룹별 완전 관측 표본을 사용. 공연문화 층은 결측 대체 없이 구조적 제외.',
                  '2인자 그룹에서 상관항이 약분되어 표준편차 비율로 귀결되는 경우 two_factor_sd_ratio로 표시.',
                  '원본 무라벨 비용 인자는 공통 열이므로 같은 조건에서 8개 업종이 같은 비중을 얻음. 억지로 업종 차이를 만들지 않음.',
                  '상수 인자·정보량 0·산출 불가 등 상태와 원래/동일 비중은 상세 JSON에 기록.',
                  '', '5. 검증 범위',json.dumps(checks,ensure_ascii=False,indent=2),
                  '단위 검증과 독립 언어 재계산 결과는 함께 제공하는 scoring-stage3-validation.json에서 확인할 수 있다.',
                  '본 단계는 비중 후보 계산만 수행했다. 후보별 추천 총점·순위·반영률 변화, 부트스트랩, 사용자 만족도 평가는 수행하지 않았다.',
                  '', '6. 적용과 다음 단계',
                  '이 후보를 현재 설정 파일·엔진·화면에 적용하지 않았다. 기존 4개 그룹 간 가중치는 그대로 보존했다.',
                  '다음 단계는 사용자 확인 후 기존·동일·CRITIC 후보의 추천 변화 및 안정성 비교이다.',
                  '', '7. 재현과 출처',
                  'tools-stage3/calculate_stage3.py --source <비중산출 폴더> --out <기준 스냅샷과 분리된 새 결과 폴더>',
                  'Python 3.12 표준 라이브러리만 사용. 원본 scoring_engine.py는 import/실행하지 않음.',
                  '원문: Diakoulaki, Mavrotas & Papayannakis (1995), https://doi.org/10.1016/0305-0548(94)00059-H',
                  '기준 규칙 SHA256: '+digest(rules_bytes)])
    (output/'scoring-stage3-report.txt').write_text('\ufeff'+'\n'.join(lines),encoding='utf-8')
    print(json.dumps(dict(referenceN=len(reference),mainGroups=32,resultRecords=len(output_data['results']),
                         quantileBudgets=quantile_budgets,validation=checks),ensure_ascii=False,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    main(args.source,args.out)
