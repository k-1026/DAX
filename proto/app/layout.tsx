import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "대구 공실 매칭",
  description: "업종에 맞는 대구 공실을 추천하는 AI 서비스",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <footer className="flex justify-center gap-4 border-t border-zinc-200 px-4 py-4 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          <Link href="/terms" className="underline">
            이용약관
          </Link>
          <Link href="/privacy" className="font-bold underline">
            개인정보 처리방침
          </Link>
        </footer>
      </body>
    </html>
  );
}
