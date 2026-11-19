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
| 6 | Vercel 첫 배포 | 예정 |
| 7 | 팀원용 설치 안내서 작성 | 예정 |

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

### 남은 일

- 6단계: Vercel 첫 배포. 그 전에 `dev-setup`을 `main`에 합쳐야 한다. (Vercel은 기본적으로 main을 배포하는데 main에는 아직 `web/`이 없다)

---

## 2026-11-18

### 로그인 기능 (이메일 + 카카오)

Supabase의 Authentication > Sign In / Providers 기능으로 이메일, 카카오 로그인을 만들었다.

추가·수정한 파일

| 파일 | 역할 |
|---|---|
| `web/proxy.ts` | 모든 요청 전에 로그인 쿠키를 갱신 (Next.js 16에서 middleware 대신 proxy) |
| `web/lib/supabase/proxy.ts` | 쿠키 갱신 도구 |
| `web/app/login/page.tsx` | 로그인 화면 |
| `web/app/login/login-form.tsx` | 카카오 버튼, 이메일 로그인/가입 양식 |
| `web/app/login/actions.ts` | 서버 동작: 이메일 로그인·가입, 카카오 로그인, 로그아웃 |
| `web/app/auth/callback/route.ts` | 카카오 로그인·이메일 인증 후 돌아오는 주소. code를 세션으로 바꿈 |
| `web/app/page.tsx` | 첫 화면에 "로그인 / 회원가입" 버튼 또는 "OO 님, 환영합니다 · 로그아웃" 표시 |

#### Supabase 대시보드 설정 (직접 해야 함)

1. **URL 설정**: Authentication > URL Configuration
   - Site URL: `http://localhost:3000` (배포 후 Vercel 주소로 변경)
   - Redirect URLs에 추가: `http://localhost:3000/auth/callback` (배포 후 `https://<vercel주소>/auth/callback`도 추가)
2. **이메일**: Authentication > Sign In / Providers > Email
   - 기본으로 켜져 있다. "Confirm email"이 켜져 있으면 가입 후 메일 인증 링크를 눌러야 로그인된다.
   - 기본 메일 발송은 시간당 몇 통으로 제한된다. 실제 운영 전에는 SMTP(메일 발송 서비스)를 연결해야 한다.
3. **카카오**: Authentication > Sign In / Providers > Kakao 를 켜고, 아래 카카오 쪽 값 입력
   - 화면에 보이는 **Callback URL** (`https://<프로젝트>.supabase.co/auth/v1/callback`)을 복사해 둔다.

#### 카카오 개발자 콘솔 설정 (developers.kakao.com)

1. 내 애플리케이션 > 애플리케이션 추가
2. 앱 키 > **REST API 키** → Supabase Kakao의 `Client ID`(REST API Key)에 입력
3. 카카오 로그인 > 보안 > **Client Secret** 생성, 활성화 → Supabase의 `Client Secret`에 입력
4. 카카오 로그인 > 활성화 ON, **Redirect URI**에 위에서 복사한 Supabase Callback URL 등록
5. 앱 설정 > 플랫폼 > Web 사이트 도메인에 `http://localhost:3000` (배포 후 Vercel 주소도) 등록
6. 카카오 로그인 > 동의항목: 닉네임(profile_nickname), 프로필 사진(profile_image) 설정
   - 이메일(account_email)은 **비즈 앱** 전환(사업자 정보 등록)을 해야 받을 수 있다.
   - 비즈 앱이 아니면 Supabase Kakao 설정에서 **"Allow users without an email"** 을 켜야 로그인이 된다.

#### 확인

- 빌드(`npm run build`)와 lint 통과.
- 로그인 화면 표시, 카카오 버튼 → `/auth/v1/authorize?provider=kakao` 로 이동하는 것까지 확인. 실제 카카오 계정 로그인은 위 설정을 마친 뒤 직접 확인해야 한다.

---

## 2026-11-19

### 로그인 기능 추가 (네이버 + 구글)

로그인 화면에 "네이버로 시작하기", "구글로 시작하기" 버튼을 추가했다. (카카오 버튼 아래)

| 파일 | 바뀐 점 |
|---|---|
| `web/app/login/actions.ts` | `signInWithKakao` → `signInWithSocial` 하나로 합침. 버튼 값(kakao/naver/google)으로 어떤 SNS인지 구분 |
| `web/app/login/login-form.tsx` | 네이버(초록), 구글(흰색) 버튼 추가 |

#### 구글 설정

1. **Google Cloud Console** (console.cloud.google.com)
   - 프로젝트를 만든다.
   - APIs & Services > OAuth consent screen(동의 화면): 앱 이름, 지원 이메일을 입력한다. 테스트 중에는 Test users에 로그인할 구글 계정을 추가한다.
   - APIs & Services > Credentials > Create Credentials > **OAuth client ID** > 유형 "Web application"
     - Authorized JavaScript origins: `http://localhost:3000` (배포 후 Vercel 주소도)
     - Authorized redirect URIs: Supabase Google 설정 화면에 보이는 Callback URL (`https://<프로젝트>.supabase.co/auth/v1/callback`)
   - 만들어진 **Client ID**와 **Client Secret**을 복사한다.
2. **Supabase** > Authentication > Sign In / Providers > **Google** 켜기, Client ID와 Client Secret 입력, 저장

#### 네이버 설정

네이버는 Supabase 기본 목록에 없다. Supabase의 **Custom OAuth Provider**(직접 추가하는 로그인 방식)로 만든다. 무료 플랜은 최대 3개까지 만들 수 있다.

1. **네이버 개발자센터** (developers.naver.com) > Application > 애플리케이션 등록
   - 사용 API: **네이버 로그인**
   - 제공 정보: 이름, 이메일, 별명, 프로필 사진 (필수/추가 선택)
   - 환경 추가: PC 웹
     - 서비스 URL: `http://localhost:3000`
     - Callback URL: 아래 2번 Supabase 화면에 보이는 Callback URL
   - 등록 후 **Client ID**와 **Client Secret**을 복사한다.
2. **Supabase** > Authentication > Sign In / Providers > **New Provider** > "Manual configuration (OAuth2)"

| 항목 | 넣을 값 |
|---|---|
| Identifier | `custom:naver` (코드와 같아야 함) |
| Name | 네이버 |
| Client ID / Client Secret | 네이버에서 받은 값 |
| Authorization URL | `https://nid.naver.com/oauth2.0/authorize` |
| Token URL | `https://nid.naver.com/oauth2.0/token` |
| Userinfo URL | `https://openapi.naver.com/v1/nid/me` |
| Scopes | 비워 둠 (네이버는 개발자센터의 "제공 정보"로 정함) |

#### 네이버 주의점 (실제 로그인으로 확인 필요)

- 네이버의 회원정보 응답은 `{"resultcode":"00","response":{"id":…,"email":…}}`처럼 값이 `response` 안에 한 겹 더 들어 있다.
- Supabase Custom Provider가 이 구조에서 회원 ID와 이메일을 읽어 오는지는 공식 문서에 나와 있지 않다. 설정 화면에 속성 매핑(attribute mapping) 칸이 있으면 `response.id`, `response.email`처럼 지정한다.
- 로그인 후 "사용자 정보를 가져올 수 없다"는 오류가 나면 이 문제다. 그때는 네이버 로그인을 서버 코드로 직접 처리하는 방식으로 바꿔야 한다.

#### 확인

- 빌드와 lint 통과.
- 세 버튼이 각각 Supabase 로그인 주소(`provider=kakao`, `provider=custom:naver`, `provider=google`)로 이동하는 것까지 확인. 실제 로그인은 위 설정 후 직접 확인해야 한다.
