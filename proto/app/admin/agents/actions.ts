"use server";

// 에이전트 화면 자동 갱신용. 관리자만 부를 수 있고, 읽기만 한다.
import { getAccess } from "@/lib/auth/access";
import { AGENT_KEYS, loadAgentView, type AgentKey, type AgentView } from "@/lib/admin/agent-view";
import { createClient } from "@/lib/supabase/server";

export async function refreshAgents(selected: string, runId: string | null): Promise<AgentView | null> {
  const access = await getAccess();
  if (access.tier !== "admin") return null;
  const key = AGENT_KEYS.includes(selected as AgentKey) ? (selected as AgentKey) : "refresh";
  const id = typeof runId === "string" && /^[0-9a-f-]{36}$/.test(runId) ? runId : null;
  return loadAgentView(await createClient(), key, id);
}
