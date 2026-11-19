// 이용약관 화면 (로그인 없이 볼 수 있다)
import type { Metadata } from "next";
import { LegalDocument } from "@/app/_components/legal-document";
import { TERMS_DOCUMENT } from "@/lib/legal/documents";

export const metadata: Metadata = { title: "이용약관 | 대구 공실 매칭" };

export default function TermsPage() {
  return <LegalDocument source={TERMS_DOCUMENT} />;
}
