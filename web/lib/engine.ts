// 서버 전용 추천 엔진: data/listings.json 을 읽어 엔진 본체(engine-core)에 넣고 계산을 맡긴다.
import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { dataMeta as coreMeta, initEngine, isEngineReady, recommend as coreRecommend, type Raw } from "./engine-core";

function ensure() {
  if (isEngineReady()) return;
  const file = path.join(process.cwd(), "data", "listings.json");
  initEngine(JSON.parse(readFileSync(file, "utf8")) as Raw);
}

export function recommend(...args: Parameters<typeof coreRecommend>) {
  ensure();
  return coreRecommend(...args);
}

export function dataMeta() {
  ensure();
  return coreMeta();
}
