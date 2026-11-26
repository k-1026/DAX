"use client";
// 글을 복사하는 작은 버튼
import { useState } from "react";

export function CopyButton({ text, label = "복사", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
      className={className ?? "rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700"}
    >
      {copied ? "복사됨" : label}
    </button>
  );
}
