# 대구 공실 매칭 — 웹앱

업종에 맞는 대구 공실을 추천하는 AI 서비스의 웹앱 코드입니다.
개발 과정은 저장소 최상위의 [web_log.md](../web_log.md)에 기록합니다.

## 팀원 개발환경 설치 (처음 한 번)

### 1. 프로그램 설치

| 프로그램 | 용도 | 받는 곳 |
|---|---|---|
| Git | 코드 이력 관리 | https://git-scm.com |
| Node.js (LTS) | 웹앱 실행 | https://nodejs.org |
| VS Code | 코드 편집기 | https://code.visualstudio.com |

설치 확인: 터미널에서 `git --version`, `node --version`을 입력해 버전이 나오면 된다.

### 2. 코드 내려받기

```bash
git clone https://github.com/k-1026/DAX
cd DAX/web
npm install
```

### 3. 환경값 파일 만들기

1. `web/.env.local.example`을 복사해 `web/.env.local`로 이름을 바꾼다.
2. Supabase 대시보드의 **Connect** 버튼에서 Project URL과 Publishable key를 복사해 붙여넣는다. (값은 팀 내부 채널로 공유)

`.env.local`은 GitHub에 올라가지 않는다. 이 저장소는 공개 상태이므로 비밀 키를 코드나 커밋에 절대 넣지 않는다.

### 4. 실행

```bash
npm run dev
```

브라우저에서 http://localhost:3000 을 열어 "● Supabase 연결 정상"이 보이면 성공이다.

### 자주 만나는 오류

**`이 시스템에서 스크립트를 실행할 수 없으므로 npm.ps1 파일을 로드할 수 없습니다`**

Windows PowerShell의 보안 설정 때문이다. 명령에 `.cmd`를 붙이면 된다.

```bash
npm.cmd install
npm.cmd run dev
```

## 배포

- 배포 주소: https://dax-mocha.vercel.app
- 현재는 Vercel 프로젝트 담당자가 자기 컴퓨터의 `web` 폴더에서 `npx.cmd vercel deploy --prod`로 올린다.
- GitHub 자동 배포 연결은 추후 진행 예정.

## 작업 규칙

- `main`에 직접 올리지 않는다. 자기 브랜치를 만들어 작업하고 Pull Request로 합친다.

```bash
git switch main
git pull
git switch -c 기능이름
# 작업 후
git add .
git commit -m "무엇을 했는지"
git push -u origin 기능이름
```

- 작업 시작 전에 항상 `git pull`로 최신 코드를 받는다.
- 새 라이브러리를 설치했으면 `package.json`, `package-lock.json`도 함께 커밋한다.

## 폴더 구조

| 위치 | 내용 |
|---|---|
| `app/` | 화면(페이지). `app/page.tsx`가 첫 화면 |
| `lib/supabase/` | Supabase 접속 도구 (브라우저용 `client.ts`, 서버용 `server.ts`) |
| `public/` | 이미지 등 정적 파일 |
| `.env.local.example` | 필요한 환경값 목록 |

## 기술 구성

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Supabase · Vercel

주의: Next.js 16은 이전 버전과 달라진 점이 많다. 코드를 쓰기 전에 `node_modules/next/dist/docs/`의 안내를 확인한다. (`AGENTS.md` 참고)
