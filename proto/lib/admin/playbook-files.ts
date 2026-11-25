// 화면별 md 규칙 파일을 읽어서 제안을 만든다(서버 전용). 규칙 파일은 content/admin-playbook/ 아래에 있다.
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { evaluatePlaybook, parsePlaybook, type Advice, type Signals } from "./playbook";

export type PlaybookScreen = "ai" | "listings" | "agents" | "mail" | "quality" | "weights" | "users";
export type AdviceResult = { advice: Advice[]; errors: string[] };

export const PLAYBOOK_FILES: Record<PlaybookScreen, string> = {
  ai: "AI사용량.md",
  listings: "매물갱신.md",
  agents: "에이전트.md",
  mail: "메일발송.md",
  quality: "품질개선.md",
  weights: "가중치.md",
  users: "사용자현황.md",
};

export function playbookPath(screen: PlaybookScreen) {
  return path.join(process.cwd(), "content", "admin-playbook", PLAYBOOK_FILES[screen]);
}

export async function adviseScreen(screen: PlaybookScreen, signals: Signals): Promise<AdviceResult> {
  try {
    const source = await readFile(playbookPath(screen), "utf8");
    return evaluatePlaybook(parsePlaybook(source), signals);
  } catch {
    return { advice: [], errors: [`규칙 파일(${PLAYBOOK_FILES[screen]})을 읽지 못했어요.`] };
  }
}
