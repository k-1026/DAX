// 목록에서 매물을 누르면 페이지를 옮기지 않고 상세 내용을 창으로 띄운다.
// 주소로 바로 들어오거나 새로고침하면 일반 상세 페이지(app/listings/[id])가 열린다.
import { Suspense } from "react";
import { DetailSection } from "@/app/listings/[id]/detail-section";
import { ListingModal } from "@/app/_components/listing-modal";

export default function ListingModalPage(props: PageProps<"/listings/[id]">) {
  return (
    <Suspense fallback={null}>
    <ListingModal>
      <Suspense fallback={<p className="p-6 text-sm text-muted">매물을 불러오는 중…</p>}>
        <ModalDetail {...props} />
      </Suspense>
    </ListingModal>
    </Suspense>
  );
}

async function ModalDetail({ params, searchParams }: PageProps<"/listings/[id]">) {
  const { id } = await params;
  const { t } = await searchParams;
  return <DetailSection id={id} token={typeof t === "string" ? t : undefined} />;
}
