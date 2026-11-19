// 첫 화면: 조건 · 추천 · 스튜디오 3단 작업 화면
// 로그인 상태(쿠키)를 읽는 부분은 Suspense 안에서 실행해야 한다 (Next.js 16 cacheComponents).
import { Suspense } from "react";
import { getViewer } from "@/lib/viewer";
import { Workspace } from "./_components/workspace";

async function WorkspaceForViewer({ searchParams }: PageProps<"/">) {
  const { as } = await searchParams;
  const viewer = await getViewer(typeof as === "string" ? as : undefined);
  return <Workspace viewer={viewer} />;
}

function Skeleton() {
  return (
    <div className="flex h-dvh flex-col">
      <div className="h-16" />
      <div className="grid flex-1 gap-4 px-4 pb-4 lg:grid-cols-[300px_1fr_340px]">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`animate-pulse rounded-2xl border border-line bg-panel ${i !== 1 ? "hidden lg:block" : ""}`} />
        ))}
      </div>
    </div>
  );
}

export default function Home(props: PageProps<"/">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <WorkspaceForViewer {...props} />
    </Suspense>
  );
}
