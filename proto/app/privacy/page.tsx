// 개인정보 처리방침 화면 (로그인 없이 볼 수 있다)
import type { Metadata } from "next";
import { LegalDocument } from "@/app/_components/legal-document";
import { PRIVACY_DOCUMENT } from "@/lib/legal/documents";

export const metadata: Metadata = { title: "개인정보 처리방침 | 대구 공실 매칭" };

export default function PrivacyPage() {
  return <LegalDocument source={PRIVACY_DOCUMENT} />;
}
