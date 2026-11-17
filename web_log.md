# 웹 개발 로그 (web_log.md)

대구 공실 매칭 AI 서비스의 개발 과정을 순서대로 기록합니다.
새 작업이 끝날 때마다 맨 아래에 이어서 적습니다.

- 저장소: https://github.com/k-1026/DAX
- 앱 코드 위치: `web/`
- 작업 브랜치: `dev-setup` (main은 건드리지 않음)

## 진행 현황

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 내 컴퓨터 상태 점검 | 완료 |
| 2 | 필수 도구 설치 | 완료 |
| 3 | Next.js 앱 뼈대 생성, 로컬 실행 확인 | 완료 |
| 4 | GitHub 로그인 후 뼈대 업로드 | 완료 |
| 5 | Supabase 프로젝트 연결 | 완료 |
| 6 | Vercel 첫 배포 | 완료 (https://dax-mocha.vercel.app) |
| 7 | 팀원용 설치 안내서 작성 | 완료 (`web/README.md`) |

## 전체 구조 (계획)

| 서비스 | 맡는 일 |
|---|---|
| GitHub | 코드 보관, 4명 협업 |
| Supabase | DB(매물·점수·회원·리뷰·로그), 로그인 |
| Vercel | 웹사이트 배포, 월 1회 매물 갱신 같은 예약 작업 |
| Claude API | 오케스트레이터와 서브에이전트(추천·스코어링) |
| 메일 발송 서비스 | 기존 사용자 추천 메일링 (3.2 기술 검증 때 선택) |

---

## 2026-11-17

### 1단계. 내 컴퓨터 상태 점검

설치 여부를 확인했다.

| 도구 | 역할 | 결과 |
|---|---|---|
| Git 2.56.0 | 코드 변경 이력 기록 | 있음 |
| Node.js 26.13.0 / npm 11.20.0 | 웹앱 실행, 라이브러리 설치 | 있음 |
| VS Code 1.146.0 | 코드 편집기 | 있음 |
| Python 3.12.10 | 데이터 처리용 | 있음 |
| GitHub CLI, Vercel CLI, Supabase CLI, Docker | | 없음 |

### 2단계. 필수 도구 설치

- GitHub CLI(gh)를 winget으로 설치했다. 터미널에서 저장소를 다루기 위한 도구다.
- Vercel·Supabase CLI는 설치하지 않았다. 웹사이트에서 연결할 수 있어 지금은 필요 없다.
- DAX 저장소를 `바탕화면\개발환경세팅\DAX`에 내려받았다.
- 저장소 확인 결과: 발표 자료, 데모 HTML, 대구 구별 매물 CSV, 리서치 등 41개 파일. 앱 코드는 없었다.
- 브랜치: `main`, `chaeeun`, `권혜림`, `지해나`, `new`. `chaeeun`과 `권혜림`은 main보다 60여 커밋 뒤처져 있어 나중에 합칠 때 정리가 필요하다.

### 결정. 앱 코드 위치

- DAX 저장소 안 `web` 폴더에 만들기로 했다.
- 이유: 매물 CSV와 앱이 한 저장소에 있어 팀원이 하나만 받으면 된다. Vercel은 하위 폴더만 골라 배포할 수 있다.

### 3단계. Next.js 앱 뼈대 생성

- `dev-setup` 브랜치를 새로 만들었다.
- 실행한 명령: `npx create-next-app@latest web --yes --use-npm --disable-git`
- 설치된 주요 부품

| 부품 | 버전 | 설명 |
|---|---|---|
| Next.js | 16.4.6 | 화면과 서버 기능을 함께 만드는 틀 |
| React | 19.3.0 | 화면을 조립하는 부품 |
| TypeScript | 5 | 실수를 미리 잡아주는 자바스크립트 |
| Tailwind CSS | 4.3.3 | 디자인을 빠르게 입히는 도구 |

- 로컬 실행 확인: `http://localhost:3000`에서 기본 첫 화면이 정상 표시됐다.
- 실행 방법: `web` 폴더에서 `npm run dev`
- 알아둘 파일: `web/app/page.tsx`(첫 화면), `web/package.json`(부품 목록)

### 4단계. GitHub 로그인 후 뼈대 업로드

- `gh auth login --web --git-protocol https`로 로그인했다. 8자리 코드는 터미널 화면에 표시되고, 브라우저에서 입력한다.
- 로그인 계정 `dcmeoh-web`은 DAX 저장소에 쓰기 권한이 있다.
- `web/` 폴더와 `web_log.md`를 커밋해 `dev-setup` 브랜치로 GitHub에 올렸다. main에는 아직 합치지 않았다.

### 주의. 저장소가 공개(PUBLIC) 상태

- DAX 저장소는 누구나 볼 수 있다.
- Supabase 키, Claude API 키 같은 비밀값은 절대 코드에 적지 않는다. `web/.env.local` 파일에만 두며, 이 파일은 GitHub에 올라가지 않도록 이미 제외되어 있다.

### 5단계. Supabase 연결 준비 (진행 중)

- Supabase 대시보드에서 프로젝트를 만들었다. (지역: 서울 권장, DB 비밀번호는 각자 안전한 곳에 보관)
- 연결 라이브러리 설치: `npm install @supabase/supabase-js @supabase/ssr`
- 추가한 파일

| 파일 | 역할 |
|---|---|
| `web/lib/supabase/client.ts` | 브라우저에서 Supabase에 접속하는 도구 |
| `web/lib/supabase/server.ts` | 서버에서 접속하는 도구 (로그인 쿠키 포함) |
| `web/.env.local.example` | 필요한 환경값 목록 예시 (GitHub에 올라감) |
| `web/.env.local` | 실제 값을 넣는 파일 (GitHub에 올라가지 않음) |

- 첫 화면(`web/app/page.tsx`)을 서비스 이름과 "Supabase 연결 상태" 표시로 바꿨다.
- 사이트 제목을 "대구 공실 매칭"으로, 언어를 한국어로 바꿨다.
- 겪은 문제: `export const dynamic = "force-dynamic"`을 쓰니 빌드 오류가 났다. 이 버전의 Next.js는 `cacheComponents` 방식이라 그 설정을 쓸 수 없다. 실시간으로 확인하는 부분을 `<Suspense>`로 감싸서 해결했다.
- 겪은 문제: `.gitignore`의 `.env*` 규칙 때문에 예시 파일도 제외됐다. `!.env.local.example` 예외를 추가했다.
- 현재 화면: "○ .env.local 에 Supabase 값이 아직 없습니다." (값을 넣으면 "● Supabase 연결 정상"으로 바뀐다)

### 5단계 완료. Supabase 연결 확인

- `web/.env.local`에 Project URL과 Publishable key를 넣었다. (Supabase 대시보드의 Connect 버튼에서 확인)
- 첫 화면에 "● Supabase 연결 정상"이 표시되는 것을 확인했다.
- Secret key(`sb_secret_`)는 넣지 않았다. 관리자용이라 나중에 서버 전용으로 따로 다룬다.

### main에 합치기

- `dev-setup`을 `main`에 합쳐 올렸다. 충돌 없이 `web/`과 `web_log.md`만 추가됐다.
- 이유: Vercel은 기본적으로 main을 배포하는데 main에 `web/`이 없으면 배포가 실패한다.

### 7단계. 팀원용 설치 안내서

- `web/README.md`를 한국어 안내서로 바꿨다. 프로그램 설치, 코드 내려받기, 환경값 파일 만들기, 실행, 브랜치 작업 규칙을 담았다.

### 6단계. Vercel 첫 배포

- 배포 주소: https://dax-mocha.vercel.app (같은 사이트: https://dax-2530.vercel.app)
- 배포된 주소에서 "● Supabase 연결 정상"이 표시되는 것을 확인했다.

**결정. 배포 방식**

- 저장소 주인이 팀원 계정(`k-1026`)이라 GitHub 자동 연결에는 그 팀원의 허락이 필요하다.
- 지금은 `dcmeoh-web`의 Vercel 계정으로, 이 컴퓨터에서 직접 올리는 방식을 썼다.
- 나중에 `k-1026` 팀원과 함께 GitHub 연결로 바꾸면 main에 올릴 때마다 자동 배포된다.

**한 일**

1. `npx.cmd vercel login`으로 로그인 (브라우저에서 승인)
2. `npx vercel link --yes --project dax`로 Vercel 프로젝트 `dax` 생성·연결
3. Supabase 값 두 개를 Vercel 환경값으로 등록 (Production·Preview·Development). `.env.local`은 GitHub에 올라가지 않으므로 Vercel에 따로 알려줘야 한다.
4. `npx vercel deploy --prod --yes`로 배포

**다시 배포하는 방법**: `web` 폴더에서 `npx.cmd vercel deploy --prod`

**겪은 문제. PowerShell에서 npx 실행이 막힘**

- 증상: `이 시스템에서 스크립트를 실행할 수 없으므로 npx.ps1 파일을 로드할 수 없습니다`
- 원인: Windows PowerShell의 보안 설정이 `.ps1` 스크립트를 막는다.
- 해결: 보안 설정은 그대로 두고 `npx.cmd`, `npm.cmd`처럼 `.cmd`를 붙여 실행한다.

**참고**: `vercel link`가 `web/.env.local`에 `VERCEL_OIDC_TOKEN` 줄을 자동으로 추가했다. 이 파일은 GitHub에 올라가지 않는다.

### 3.1 개발환경 세팅 마무리

계정·저장소·Supabase·Vercel 셋업과 개발환경 설치 안내까지 끝났다.

### 다음 할 일 (3.2, 3.3)

- 팀원 3명이 `web/README.md`를 따라 각자 컴퓨터에 설치
- `k-1026` 팀원과 Vercel–GitHub 자동 배포 연결
- 3.2 기술 검증: 로그인, 메일 발송, 예약 작업(스케줄), Claude API 최소 동작
- 3.3 DB 설계: 매물·점수·회원·리뷰·로그 테이블과 접근 규칙(RLS)
