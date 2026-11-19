// 발표용 단일 HTML 만들기: node demo/build.mjs "<출력 경로>"
// 1) 실제 앱 화면(React)을 하나의 JS로 묶고 2) next build 결과 CSS를 붙이고 3) 매물 데이터까지 한 파일에 넣는다.
// 먼저 `npm run build` 를 해 두어야 CSS가 있다.
import { build } from "esbuild";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, "..");
const out = process.argv[2] ?? path.join(here, "demo.html");

const swap = {
  "@/lib/recommend-client": path.join(here, "recommend-local.ts"),
  "@/app/login/actions": path.join(here, "stubs", "login-actions.ts"),
  "next/link": path.join(here, "stubs", "next-link.tsx"),
};
const alias = {
  name: "demo-alias",
  setup(b) {
    b.onResolve({ filter: /^(@\/lib\/recommend-client|@\/app\/login\/actions|next\/link)$/ }, (a) => ({ path: swap[a.path] }));
    b.onResolve({ filter: /\.css$/ }, () => ({ path: "empty-css", namespace: "empty" }));
    b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
  },
};

const res = await build({
  entryPoints: [path.join(here, "entry.tsx")],
  bundle: true,
  write: false,
  minify: true,
  format: "iife",
  jsx: "automatic",
  target: "es2020",
  absWorkingDir: web,
  tsconfig: path.join(web, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [alias],
  logLevel: "warning",
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, "<\/script");

// next build 가 만든 CSS (Tailwind 결과 + leaflet). next/font 의 로컬 글꼴 파일은 쓰지 않는다.
const cssDir = path.join(web, ".next", "static", "chunks");
const cssFiles = readdirSync(cssDir).filter((f) => f.endsWith(".css"));
let css = cssFiles.map((f) => readFileSync(path.join(cssDir, f), "utf8")).join("\n");
if (!css.includes("map-pin")) throw new Error("CSS에 지도 핀 스타일이 없습니다. 먼저 npm run build 를 하세요.");
css = css.replace(/@font-face\{[^}]*\}/g, "").replace(/\/\*[^*]*\*+([^/*][^*]*\*+)*\//g, "");

const html = `<!doctype html>
<html lang="ko" class="h-full antialiased">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>대구 공실 매칭 · 26.11.19 발표 데모</title>
<meta name="description" content="업종에 맞는 대구 공실을 추천하는 AI 서비스 발표 데모 (실제 매물 2,717건, 2026-11-10 기준)">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap">
<style>:root{--font-noto:'Noto Sans KR';--font-geist-mono:ui-monospace}</style>
<style>${css}</style>
</head>
<body class="flex min-h-full flex-col">
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;
writeFileSync(out, html);
console.log(`저장: ${out} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)}MB, CSS ${cssFiles.length}개)`);
