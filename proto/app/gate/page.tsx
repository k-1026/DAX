// 시험 사이트 입구. 팀이 받은 입장 비밀번호를 넣으면 30일 동안 다시 묻지 않는다.
import { Suspense } from "react";
import { SiteLogo } from "@/app/_components/site-logo";
import { GateForm } from "./gate-form";

export default function GatePage(props: PageProps<"/gate">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <SiteLogo />
      <div className="card flex flex-col gap-4 p-6">
        <div>
          <h1 className="text-lg font-medium">시험용 사이트예요</h1>
          <p className="mt-1 text-sm text-muted">팀에서 받은 입장 비밀번호를 넣어 주세요. 이 사이트의 매물·계정·메일은 모두 시험용이에요.</p>
        </div>
        <Suspense fallback={null}>
          <GateFromProps {...props} />
        </Suspense>
      </div>
    </main>
  );
}

async function GateFromProps({ searchParams }: PageProps<"/gate">) {
  const { next } = await searchParams;
  return <GateForm next={typeof next === "string" ? next : "/"} />;
}
