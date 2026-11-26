// 매물 상세 페이지 (주소로 바로 들어오거나 새로고침했을 때). 목록에서 누르면 같은 내용이 창으로 뜬다(@modal).
import Link from "next/link";
import { Suspense } from "react";
import { SiteLogo } from "@/app/_components/site-logo";
import { DetailSection } from "./detail-section";

export default function ListingPage(props: PageProps<"/listings/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <SiteLogo />
        <Link href="/" className="rounded-full border border-line bg-panel px-3.5 py-2 text-sm hover:bg-soft">
          ← 검색으로
        </Link>
      </div>
      <Suspense fallback={<p className="text-sm text-zinc-500">매물을 불러오는 중…</p>}>
        <DetailFromProps {...props} />
      </Suspense>
    </main>
  );
}

async function DetailFromProps({ params, searchParams }: PageProps<"/listings/[id]">) {
  const { id } = await params;
  const { t } = await searchParams;
  return <DetailSection id={id} token={typeof t === "string" ? t : undefined} />;
}
