// 관리자 "에이전트 실행": 자동 작업별 상태 불빛과 로그 박스(읽기만).
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { loadAgentView } from "@/lib/admin/agent-view";
import { createClient } from "@/lib/supabase/server";
import { AgentsLive } from "./agents-live";

export const metadata: Metadata = { title: "에이전트 실행 | DːON 관리자", robots: { index: false, follow: false } };

async function AdminAgentsContent() {
  await connection();
  const initial = await loadAgentView(await createClient(), "refresh", null);
  return <AgentsLive initial={initial} />;
}

export default function AdminAgents() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">불러오는 중…</p>}>
      <AdminAgentsContent />
    </Suspense>
  );
}
