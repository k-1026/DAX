// 이메일로 가입한 직후 한 번 보여 주는 프로필 사진 설정 화면 (건너뛰면 기본 이미지)
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Avatar } from "@/app/_components/avatar";
import { SiteLogo } from "@/app/_components/site-logo";
import { AvatarUploadForm } from "@/app/mypage/mypage-forms";
import { toSafePath } from "@/lib/legal/versions";
import { createClient } from "@/lib/supabase/server";
import { skipAvatar } from "./actions";

export const metadata: Metadata = { title: "프로필 사진 | 대구 공실 매칭" };

type Props = { searchParams: Promise<{ next?: string | string[] }> };

async function Content({ searchParams }: Props) {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");
  const next = toSafePath((await searchParams).next);

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, avatar_url")
    .eq("id", data.claims.sub)
    .maybeSingle();

  return (
    <div className="card flex w-full flex-col gap-5 p-6">
      <h1 className="text-xl font-medium">프로필 사진을 설정해 보세요</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        건너뛰면 이름 첫 글자가 들어간 기본 이미지로 시작해요. 마이페이지에서 언제든 바꿀 수 있어요.
      </p>
      <div className="flex justify-center">
        <Avatar url={profile?.avatar_url} name={profile?.display_name ?? data.claims.email} size={96} />
      </div>
      <AvatarUploadForm />
      <form action={skipAvatar} className="flex flex-col gap-2">
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="rounded-full bg-brand py-2.5 text-sm font-medium text-brand-ink">
          {profile?.avatar_url ? "계속하기" : "건너뛰기"}
        </button>
      </form>
    </div>
  );
}

export default function WelcomeAvatarPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <SiteLogo />
      <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}>
        <Content {...props} />
      </Suspense>
    </main>
  );
}
