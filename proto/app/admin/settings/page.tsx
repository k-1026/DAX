// 관리자 "설정값": 서비스가 쓰는 기준 숫자를 쉬운 말로 묶어 보여 준다(읽기만, 바꾸는 기능 없음).
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { GROUP_HINT, GROUP_ORDER, SETTING_LABELS, describeSetting, type SettingRow } from "@/lib/admin/setting-labels";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "설정값 | DːON 관리자", robots: { index: false, follow: false } };

async function AdminSettingsContent() {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("key, value, description").order("key");
  // 쉬운 말 표에 적힌 순서대로 보여 준다(표에 없는 것은 맨 뒤).
  const order = Object.keys(SETTING_LABELS);
  const rank = (row: SettingRow) => {
    const i = order.indexOf(row.description ?? "");
    return i === -1 ? order.length : i;
  };
  const rows = ((data ?? []) as SettingRow[]).sort((a, b) => rank(a) - rank(b)).map(describeSetting);

  return (
    <>
      <p className="px-1 text-sm text-muted">서비스가 쓰는 기준 숫자예요. 지금은 보기만 해요(바꾸는 기능은 없어요). 총 {rows.length}개.</p>
      {GROUP_ORDER.map((group) => {
        const items = rows.filter((row) => row.group === group);
        if (items.length === 0) return null;
        return (
          <section key={group} className="card p-4">
            <h2 className="text-[0.9375rem] font-medium">{group}</h2>
            <p className="mb-2 text-xs text-faint">{GROUP_HINT[group]}</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[0.8125rem]">
                <tbody>
                  {items.map((row) => (
                    <tr key={row.rawDescription}>
                      <td className="border-t border-line px-1.5 py-2">
                        {row.label}
                        {row.note && <span className="block text-xs text-faint">{row.note}</span>}
                      </td>
                      <td className="whitespace-nowrap border-t border-line px-1.5 py-2 text-right font-medium tabular-nums">{row.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}

export default function AdminSettings() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">불러오는 중…</p>}>
      <AdminSettingsContent />
    </Suspense>
  );
}
