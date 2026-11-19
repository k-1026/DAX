// 관리자 전용 화면. 관리자가 아니면 페이지가 없는 것처럼 처리한다.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "관리자 | 대구 공실 매칭",
  robots: { index: false, follow: false },
};

function formatValue(value: unknown) {
  return value === null ? "제한 없음" : String(value);
}

async function AdminContent() {
  await connection();
  const access = await getAccess();
  if (access.tier !== "admin") notFound();

  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("app_settings")
    .select("key, value, description")
    .order("key");

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">등급별 한도 설정값</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              <th scope="col" className="border border-zinc-300 bg-zinc-100 px-3 py-2 font-medium dark:border-zinc-700 dark:bg-zinc-900">
                항목
              </th>
              <th scope="col" className="border border-zinc-300 bg-zinc-100 px-3 py-2 font-medium dark:border-zinc-700 dark:bg-zinc-900">
                현재 값
              </th>
            </tr>
          </thead>
          <tbody>
            {settings?.map((setting) => (
              <tr key={setting.key}>
                <td className="border border-zinc-300 px-3 py-2 dark:border-zinc-700">
                  {setting.description}
                </td>
                <td className="border border-zinc-300 px-3 py-2 tabular-nums dark:border-zinc-700">
                  {formatValue(setting.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function AdminPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-bold">관리자</h1>
      <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}>
        <AdminContent />
      </Suspense>
    </main>
  );
}
