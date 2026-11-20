비중산출 보고서 목록

현재 상태: 3단계 비중 후보 계산 완료. 사용자 확인 전 4단계 추천 변화·안정성 검증 미진행. 현재 엔진·화면에 적용하지 않음.

scoring-stage1-report.txt / scoring-stage1-audit.json: 입력 진단 결과
scoring-stage2-report.txt / scoring-stage2-rules.json: 승인된 산출 규칙(당시 상태 문구는 역사적 기록)
scoring-stage3-report.txt: 8개 업종×4개 그룹 내부 비중 후보·기존/보조 후보 비교
scoring-stage3-results.json: 표본·상관·정보량·정밀 비중·예산별 후보 상세
scoring-stage3-validation.json: 11개 테스트, 독립 언어 전수 검산, 원본/재배치 manifest 체인 확인
tools-stage3/: Python 표준 라이브러리 기반 재현 도구·테스트·실행계획·원본 승인 manifest 사본
scoring-baseline-manifest.json / baseline-stage1/: 보존한 10개 기준 스냅샷과 해시

주 후보는 기존 점수척도 유지형 CRITIC이고 원 논문의 표본 min-max 전처리 후보는 별도 결과로 제공함. 통계적 비중 후보이며 실제 임차인 선호·추천 정확도 검증 결과가 아님.
