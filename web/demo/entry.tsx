// 발표용 단일 HTML의 시작점: 실제 앱의 작업 화면을 그대로 띄우고, 비회원/회원 화면을 바꿔 볼 수 있게 한다.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "../app/_components/workspace";
import type { Viewer } from "../lib/viewer";

const GUEST: Viewer = { loggedIn: false, name: "게스트", isAdmin: false };
const MEMBER: Viewer = { loggedIn: true, name: "발표 회원", isAdmin: false, previewAs: "member" };

function Demo() {
  const [member, setMember] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    const on = () => setMember(true);
    const off = () => setMember(false);
    const toast = (e: Event) => {
      setNote((e as CustomEvent<string>).detail);
      setTimeout(() => setNote(null), 2200);
    };
    window.addEventListener("demo-login", on);
    window.addEventListener("demo-logout", off);
    window.addEventListener("demo-toast", toast);
    return () => {
      window.removeEventListener("demo-login", on);
      window.removeEventListener("demo-logout", off);
      window.removeEventListener("demo-toast", toast);
    };
  }, []);

  return (
    <>
      <Workspace key={member ? "m" : "g"} viewer={member ? MEMBER : GUEST} />
      <div
        role="group"
        aria-label="발표용 화면 전환"
        style={{ position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 60 }}
        className="flex items-center gap-1 rounded-full border border-line bg-panel p-1 text-xs shadow-lg"
      >
        <span className="px-2 text-muted">발표 데모</span>
        {[
          [false, "비회원 화면"],
          [true, "회원 화면"],
        ].map(([v, label]) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={member === v}
            onClick={() => setMember(v as boolean)}
            className={`rounded-full px-3 py-1.5 ${member === v ? "bg-brand text-brand-ink" : "text-muted hover:bg-soft"}`}
          >
            {label as string}
          </button>
        ))}
      </div>
      {note && (
        <div role="status" style={{ position: "fixed", top: 64, left: "50%", transform: "translateX(-50%)", zIndex: 60 }} className="rounded-xl bg-brand px-4 py-3 text-sm text-brand-ink shadow-lg">
          {note}
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Demo />);
