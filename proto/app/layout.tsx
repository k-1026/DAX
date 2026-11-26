import type { Metadata } from "next";
import { Geist_Mono, Noto_Sans_KR } from "next/font/google";
import Link from "next/link";
import "./globals.css";

// 발표 데모와 같은 글꼴. 한글 글자 조각은 쓸 때만 내려받는다.
const notoSans = Noto_Sans_KR({
  variable: "--font-noto",
  weight: ["400", "500"],
  display: "swap",
  preload: false,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DːON",
  description: "업종에 맞는 대구 공실을 추천하는 AI 서비스",
};

export default function RootLayout({ children, modal }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${notoSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {modal}
        <footer className="site-footer flex justify-center gap-4 border-t border-zinc-200 px-4 py-4 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          <Link href="/terms" className="underline">
            이용약관
          </Link>
          <Link href="/privacy" className="font-medium underline">
            개인정보 처리방침
          </Link>
          <Link href="/report" className="underline">
            문제 신고
          </Link>
        </footer>
      </body>
    </html>
  );
}
