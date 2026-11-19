// 이전 데모 HTML(단일 파일)에서 매물·점수 규칙·동 중심 좌표를 뽑아 web/data/listings.json 으로 저장한다.
// 사용법: node scripts/import-demo.mjs "<데모 HTML 경로>"
// 매물 수집 에이전트가 3일마다 새 데이터를 만들면 같은 형식으로 이 파일을 바꿔 끼우면 된다.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const src = process.argv[2];
if (!src) {
  console.error('사용법: node scripts/import-demo.mjs "<데모 HTML 경로>"');
  process.exit(1);
}
const html = readFileSync(src, "utf8");
function grab(name) {
  const start = html.indexOf(`var ${name} = {`);
  if (start < 0) throw new Error(`${name} 를 찾지 못했습니다`);
  const end = html.indexOf("\n", start);
  const line = html.slice(start, end);
  return JSON.parse(line.slice(line.indexOf("{"), line.lastIndexOf("}") + 1));
}
const CFG = grab("CFG");
const D = grab("D");
const MAP = grab("MAP");

const dongCenters = Object.fromEntries(Object.entries(MAP.dongs).map(([k, v]) => [k, v.c]));
const out = {
  date: D.date,
  source: D.source,
  mapSource: MAP.source,
  cats: D.cats,
  radius: D.radius,
  demand: D.demand,
  reasons: D.reasons,
  cfg: CFG,
  gus: MAP.gus,
  dongCenters,
  rows: D.rows,
};
const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "listings.json");
writeFileSync(dest, JSON.stringify(out));
console.log(`저장: ${dest} · 매물 ${D.rows.length}건 · 기준일 ${D.date} · 동 ${Object.keys(dongCenters).length}곳`);
