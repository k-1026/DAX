import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateCondition, evaluatePlaybook, parsePlaybook } from '../lib/admin/playbook.ts';
import { buildAiSignals } from '../lib/admin/ai-signals.ts';

const dir = new URL('../content/admin-playbook/', import.meta.url);
const FILES = ['AI사용량.md', '매물갱신.md', '에이전트.md', '메일발송.md', '품질개선.md', '가중치.md', '사용자현황.md'];
const read = (name) => readFileSync(new URL(name, dir), 'utf8');

test('조건 계산: 비교·그리고/또는·괄호·사칙연산', () => {
  const c = { a: 5, b: 10, 기준: 3 };
  assert.equal(evaluateCondition('a >= 5', c), true);
  assert.equal(evaluateCondition('a > 5', c), false);
  assert.equal(evaluateCondition('a >= 5 그리고 b < 11', c), true);
  assert.equal(evaluateCondition('a > 9 또는 b == 10', c), true);
  assert.equal(evaluateCondition('(a > 9 또는 b == 10) 그리고 a < 1', c), false);
  assert.equal(evaluateCondition('b >= a * 기준 / 2', c), true); // 10 >= 7.5
  assert.equal(evaluateCondition('a - 6 < 0', c), true);
});

test('조건 계산: 알 수 없는 이름·문법 오류·0으로 나누기는 오류', () => {
  assert.throws(() => evaluateCondition('없는이름 > 1', {}), /알 수 없는 이름/);
  assert.throws(() => evaluateCondition('a >', { a: 1 }), /끝났어요/);
  assert.throws(() => evaluateCondition('a / 0 > 1', { a: 1 }), /0으로/);
  assert.throws(() => evaluateCondition('a > 1 )', { a: 1 }), /남은 말/);
  // 코드를 넣어도 실행되지 않고 오류가 된다.
  assert.throws(() => evaluateCondition('process.exit(1)', {}));
});

test('규칙 파일 7개는 문법 오류가 없고 규칙이 있다', () => {
  for (const name of FILES) {
    const book = parsePlaybook(read(name));
    assert.deepEqual(book.errors, [], `${name}: ${book.errors.join(' / ')}`);
    assert.ok(book.rules.length >= 5, `${name} 규칙 수`);
    assert.ok(book.fallback, `${name} 기본 문구`);
  }
});

test('규칙 파일의 조건·문구에 쓴 이름은 모두 "쓸 수 있는 이름" 또는 기준 숫자다', () => {
  for (const name of FILES) {
    const source = read(name);
    const book = parsePlaybook(source);
    const header = source.split('## 기준 숫자')[0];
    const allowed = new Set([...header.matchAll(/[가-힣A-Za-z_][가-힣A-Za-z0-9_]*/g)].map((m) => m[0]));
    for (const key of Object.keys(book.constants)) allowed.add(key);
    const used = (text) => [...text.matchAll(/[가-힣A-Za-z_][가-힣A-Za-z0-9_]*/g)].map((m) => m[0]).filter((word) => word !== '그리고' && word !== '또는');
    for (const rule of book.rules) {
      for (const word of used(rule.condition)) assert.ok(allowed.has(word), `${name} "${rule.title}" 조건의 ${word}`);
      for (const text of [rule.reading, rule.action]) for (const m of text.matchAll(/\{([^{}]+)\}/g)) assert.ok(allowed.has(m[1].trim()), `${name} "${rule.title}" 문구의 {${m[1]}}`);
    }
  }
});

const day = (o = {}) => ({ day: '11/24', guest: 0, member: 0, subscriber: 0, admin: 0, withdrawn: 0, ai1: 0, ai2: 0, ai3: 0, ai4: 0, ...o });
const baseUsage = {
  days: 30, today: 0, period: 0, prev_period: 0, avg7: 0, features: {}, series: [day()],
  distribution: { member: null, subscriber: null }, reached: { member: 0, subscriber: 0, guest_total: 0 },
  guest_today: 0, limits: { member: 10, subscriber: 30, guest_total: 3, guest_cap: 300 },
};
const run = (usage) => {
  const book = parsePlaybook(read('AI사용량.md'));
  return evaluatePlaybook(book, buildAiSignals({ ...baseUsage, ...usage }));
};
const titles = (result) => result.advice.map((item) => item.title);

test('AI 사용량: 기록이 적으면 안내, 없는 이름 오류는 없다', () => {
  const result = run({ period: 5 });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(titles(result), ['아직 기록이 적어서 판단하기 이르러요']);
});

test('AI 사용량: 기록은 충분하고 이상 없으면 "특별히 할 일이 없어요"', () => {
  const result = run({ period: 120, today: 5, avg7: 4, features: { ai1_search_text: { today: 1, month: 40, period: 40 }, ai2_explain: { today: 2, month: 40, period: 40 }, ai4_assistant: { today: 2, month: 40, period: 40 } } });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(titles(result), ['지금은 특별히 할 일이 없어요']);
});

test('AI 사용량: 여러 문제가 겹치면 급한 순서로 나온다', () => {
  const result = run({
    period: 400, prev_period: 150, today: 60, avg7: 15, guest_today: 270,
    series: [day({ guest: 40, member: 20, ai2: 55, ai1: 5 })],
    features: { ai1_search_text: { today: 5, month: 60, period: 60 }, ai2_explain: { today: 55, month: 300, period: 300 }, ai4_assistant: { today: 0, month: 0, period: 0 } },
    distribution: { member: { b1: 1, b2: 2, b3: 6, b4: 3 }, subscriber: null },
    reached: { member: 2, subscriber: 0, guest_total: 4 },
  });
  assert.deepEqual(result.errors, []);
  const list = titles(result);
  assert.equal(result.advice[0].level, 'now');
  assert.ok(list.includes('비회원이 갑자기 몰렸어요'));
  assert.ok(!list.includes('회원 중심으로 사용이 갑자기 늘었어요'));
  for (const expected of ['비회원 상한에 가까워지고 있어요', '사용이 기간 전체로 크게 늘었어요', '로그인 회원 한도가 낮을 수 있어요', '비회원이 AI 한도를 다 쓰고 있어요', '한 기능에 사용이 몰려 있어요', '공실이 대화가 한 번도 쓰이지 않았어요']) {
    assert.ok(list.includes(expected), expected);
  }
  const levels = result.advice.map((item) => item.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => ({ now: 0, soon: 1, info: 2 })[a] - ({ now: 0, soon: 1, info: 2 })[b]));
});

test('AI 사용량: 비회원 상한 도달·회원 중심 급증·한도 넉넉', () => {
  assert.ok(titles(run({ period: 100, guest_today: 300, today: 20, avg7: 18, series: [day({ guest: 20, ai1: 20 })] })).includes('비회원 AI가 오늘 막혔어요'));
  assert.ok(titles(run({ period: 200, today: 30, avg7: 5, series: [day({ member: 30, ai2: 30 })] })).includes('회원 중심으로 사용이 갑자기 늘었어요'));
  assert.ok(titles(run({ period: 200, today: 8, avg7: 7, distribution: { member: { b1: 38, b2: 1, b3: 1, b4: 0 }, subscriber: null } })).includes('로그인 회원 한도는 넉넉한 편이에요'));
});

test('문구: 숫자와 글자가 들어가고, 모르는 이름은 오류로 알린다', () => {
  const book = parsePlaybook('## 상황: 시험\n- 수준: 참고\n- 조건: 값 >= 1\n- 해석: {값}개, {이름}, {없는이름}\n- 할 일: 확인해 주세요.\n');
  const result = evaluatePlaybook(book, { 값: 1234, 이름: '가나다' });
  assert.equal(result.advice[0].reading, '1,234개, 가나다, ?');
  assert.ok(result.errors.some((error) => error.includes('없는이름')));
});

test('규칙 하나가 잘못돼도 나머지는 동작하고 오류가 보고된다', () => {
  const book = parsePlaybook('## 상황: 좋은 규칙\n- 수준: 곧 점검\n- 조건: 값 >= 1\n- 해석: 해석\n- 할 일: 할 일\n\n## 상황: 나쁜 규칙\n- 수준: 곧 점검\n- 조건: 모르는이름 > 1\n- 해석: 해석\n- 할 일: 할 일\n\n## 상황: 수준 오류\n- 수준: 급함\n- 조건: 값 >= 1\n- 해석: 해석\n- 할 일: 할 일\n');
  const result = evaluatePlaybook(book, { 값: 2 });
  assert.deepEqual(result.advice.map((item) => item.title), ['좋은 규칙']);
  assert.equal(result.errors.length, 2);
});

const quality = {
  리포트_없음: 0, 리포트_경과_일: 2, 리포트_경보_기준_일: 8, 측정전: 0, 주의_지표_수: 0, 판단보류_지표_수: 0, 측정전_지표_수: 0, 연속_주의_최대: 0,
  긴급_후보_수: 0, 열린_후보_수: 0, 새_후보_수: 0, 보류_후보_수: 0, 가장_오래된_후보_일: 0, 시험용_후보_수: 0,
};
const runQuality = (signals) => evaluatePlaybook(parsePlaybook(read('품질개선.md')), { ...quality, ...signals });

test('품질·개선: 이상 없으면 기본 문구, 규칙 오류 없음', () => {
  const result = runQuality({});
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.advice.map((item) => item.title), ['품질과 개선 후보 모두 평소 범위예요']);
});

test('품질·개선: 긴급 후보는 맨 위 지금 확인, 주의·쌓임·오래됨이 함께 나온다', () => {
  const result = runQuality({ 긴급_후보_수: 1, 열린_후보_수: 6, 새_후보_수: 5, 보류_후보_수: 1, 주의_지표_수: 2, 연속_주의_최대: 3, 리포트_경과_일: 9, 가장_오래된_후보_일: 20 });
  assert.deepEqual(result.errors, []);
  assert.equal(result.advice[0].level, 'now');
  assert.equal(result.advice[0].title, '긴급 개선 후보가 있어요');
  const list = result.advice.map((item) => item.title);
  for (const expected of ['이번 주 품질 리포트에 주의 항목이 있어요', '같은 주의가 여러 주째 이어지고 있어요', '검토하지 않은 개선 후보가 쌓였어요', '품질 리포트가 오래됐어요', '후보를 처리하는 버튼은 아직 없어요']) {
    assert.ok(list.includes(expected), expected);
  }
});

test('품질·개선: 리포트 없음·실제 수집 전·판단 보류 안내', () => {
  assert.ok(runQuality({ 리포트_없음: 1 }).advice.some((item) => item.title === '아직 품질 리포트가 없어요'));
  assert.ok(runQuality({ 측정전: 1 }).advice.some((item) => item.title === '실제 수집 전이라 대부분 측정 전이에요'));
  assert.ok(runQuality({ 판단보류_지표_수: 6 }).advice.some((item) => item.title === '판단을 보류한 지표가 많아요'));
});

const weights = {
  보정안_대기_수: 0, 보정안_승인_수: 0, 보정안_반려_수: 0, 표본적음_대기_수: 0, 업종_수: 3, 활성_점수_버전_수: 1, 기준비율_정함: 1, 기준비율_상태: '정해짐', 준비_완료: 1,
  평가_전체: 80, 평가_좋아요: 40, 평가_싫어요: 40, 사유_선택_싫어요: 30, 보정안_최소_표본: 10, 보정안_최소_사용자: 3, 표본_부족: 0,
  사유_최다_이름: '임대료·조건', 사유_최다_비율: 30, 정보오류_비율: 10, 주간_리포트_없음: 0, 분류확인_실패: 0, 분류확인_일치율: 90, 분류확인_기준: 80,
};
const runWeights = (signals) => evaluatePlaybook(parsePlaybook(read('가중치.md')), { ...weights, ...signals });

test('가중치 보정안: 모두 갖춰지고 이상 없으면 기본 문구', () => {
  const result = runWeights({});
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.advice.map((item) => item.title), ['보정안과 평가 모두 평소 범위예요']);
});

test('가중치 보정안: 분류 미달은 지금 확인, 대기 보정안·정보 오류 몰림은 곧 점검', () => {
  const result = runWeights({ 분류확인_실패: 1, 분류확인_일치율: 60, 보정안_대기_수: 2, 표본적음_대기_수: 1, 정보오류_비율: 45 });
  assert.deepEqual(result.errors, []);
  assert.equal(result.advice[0].title, 'AI 분류 일치율이 기준에 못 미쳐요');
  assert.equal(result.advice[0].level, 'now');
  const list = result.advice.map((item) => item.title);
  assert.ok(list.includes('승인을 기다리는 보정안이 있어요'));
  assert.ok(list.includes('정보 오류 사유가 많이 몰려요'));
});

test('가중치 보정안: 준비 전·표본 부족·기록 없음 안내가 나온다', () => {
  const result = runWeights({ 업종_수: 0, 활성_점수_버전_수: 0, 기준비율_정함: 0, 기준비율_상태: '미확정', 준비_완료: 0, 사유_선택_싫어요: 3, 표본_부족: 1, 주간_리포트_없음: 1 });
  assert.deepEqual(result.errors, []);
  const list = result.advice.map((item) => item.title);
  for (const expected of ['보정안이 나오려면 아직 준비가 필요해요', '보정안에 쓸 평가가 아직 모이는 중이에요', '주간 분석 기록이 아직 없어요']) assert.ok(list.includes(expected), expected);
  assert.ok(result.advice.every((item) => item.level === 'info'));
});

const users = {
  전체_회원: 100, 관리자_수: 1, 구독_회원_수: 5, 일반_회원_수: 95, 신규_오늘: 2, 신규_평소: 2, 신규_7일: 14, 신규_전주: 12, 신규_14일: 26, 신규_30일: 50,
  탈퇴_7일: 1, 탈퇴_전주: 1, 탈퇴_배수: 1, 탈퇴_30일: 4, 탈퇴율_퍼센트: 8, 탈퇴_최다_사유: '기타', 탈퇴_최다_사유_비율: 25,
  메일_동의_수: 60, 메일_동의_퍼센트: 60, 행동기록_동의_퍼센트: 50, 메일주소_등록_수: 70, 메일주소_등록_퍼센트: 70, 구독_전환_퍼센트: 5,
};
const runUsers = (signals) => evaluatePlaybook(parsePlaybook(read('사용자현황.md')), { ...users, ...signals });

test('사용자 현황: 이상 없으면 기본 문구, 규칙 오류 없음', () => {
  const result = runUsers({});
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.advice.map((item) => item.title), ['가입, 탈퇴, 동의 모두 평소 범위예요']);
});

test('사용자 현황: 가입 급증·탈퇴 증가·탈퇴율·사유 쏠림', () => {
  const result = runUsers({ 신규_오늘: 12, 신규_평소: 2, 탈퇴_7일: 6, 탈퇴_전주: 2, 탈퇴_배수: 3, 탈퇴율_퍼센트: 40, 탈퇴_30일: 10, 탈퇴_최다_사유: '사용하기 불편해요', 탈퇴_최다_사유_비율: 60 });
  assert.deepEqual(result.errors, []);
  const list = result.advice.map((item) => item.title);
  for (const expected of ['가입이 갑자기 늘었어요', '탈퇴가 늘고 있어요', '가입 대비 탈퇴가 많아요', '탈퇴 이유가 한쪽으로 몰려 있어요']) assert.ok(list.includes(expected), expected);
  assert.ok(result.advice.find((item) => item.title === '탈퇴 이유가 한쪽으로 몰려 있어요').reading.includes('사용하기 불편해요'));
});

test('사용자 현황: 메일 동의 적음·가입 멈춤·구독 전환 낮음·회원 적음', () => {
  assert.ok(runUsers({ 메일_동의_퍼센트: 10 }).advice.some((item) => item.title === '추천 메일 수신 동의가 적어요'));
  assert.ok(runUsers({ 신규_14일: 0 }).advice.some((item) => item.title === '한동안 새 가입이 없어요'));
  assert.ok(runUsers({ 구독_전환_퍼센트: 1 }).advice.some((item) => item.title === '구독으로 넘어오는 회원이 적어요'));
  const small = runUsers({ 전체_회원: 3, 메일_동의_퍼센트: 0, 구독_전환_퍼센트: 0, 신규_14일: 0 });
  assert.deepEqual(small.advice.map((item) => item.title), ['아직 회원이 적어서 판단하기 이르러요']);
});
