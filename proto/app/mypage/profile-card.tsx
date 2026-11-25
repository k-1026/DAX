"use client";
// 마이페이지 맨 위 프로필 카드: 사진·이름·등급·이메일을 한눈에 보여 주고, 눌러서 사진·정보를 고친다.
import { useState } from "react";
import { Avatar } from "@/app/_components/avatar";
import { removeAvatar } from "./actions";
import { AvatarUploadForm, ProfileForm } from "./mypage-forms";

type Panel = "photo" | "info" | null;

const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 aria-expanded:bg-zinc-100 dark:aria-expanded:bg-zinc-800";

export function ProfileCard({
  avatarUrl,
  displayName,
  contactEmail,
  loginEmail,
  joinedAt,
  badge,
  adminLink,
}: {
  avatarUrl: string | null;
  displayName: string;
  contactEmail: string;
  loginEmail: string;
  joinedAt: string;
  badge: React.ReactNode;
  adminLink?: React.ReactNode;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const toggle = (next: Exclude<Panel, null>) => setPanel((current) => (current === next ? null : next));

  return (
    <section className="flex flex-col gap-4 card p-5">
      <div className="flex items-center gap-4">
        <Avatar url={avatarUrl} name={displayName || loginEmail} size={72} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[1.08rem] font-medium">{displayName || "이름 없음"}</h2>
            {badge}
          </div>
          <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">{loginEmail}</p>
          <p className="text-xs text-zinc-500">가입일 {joinedAt}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" aria-expanded={panel === "photo"} onClick={() => toggle("photo")} className={buttonClass}>
          사진 변경
        </button>
        <button type="button" aria-expanded={panel === "info"} onClick={() => toggle("info")} className={buttonClass}>
          정보 수정
        </button>
        {adminLink}
      </div>

      {panel === "photo" && (
        <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <AvatarUploadForm />
          {avatarUrl && (
            <form action={removeAvatar}>
              <button type="submit" className="text-xs underline">
                사진 삭제
              </button>
            </form>
          )}
        </div>
      )}
      {panel === "info" && (
        <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <ProfileForm displayName={displayName} contactEmail={contactEmail} />
        </div>
      )}
    </section>
  );
}
