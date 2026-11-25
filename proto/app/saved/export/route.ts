// 담은 매물 목록을 엑셀(.xlsx)로 내려받는다. 로그인한 본인의 목록만, 화면에 보이는 항목만 넣는다(점수는 아직 없다).
import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { getSavedState } from "@/lib/saved/server";
import { savedAddress, savedDate, savedSource } from "@/lib/saved/display";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SQM_PER_PYEONG = 3.3058;

export async function GET(request: NextRequest) {
  const state = await getSavedState();
  if (state.tier === "guest") return NextResponse.json({ error: "로그인 후 이용할 수 있어요." }, { status: 401 });
  if (!state.ok) return NextResponse.json({ error: "담은 매물을 불러오지 못했어요." }, { status: 503 });

  // 목록 번호는 본인 목록 중에서만 고른다.
  const wanted = request.nextUrl.searchParams.get("list");
  const list = state.lists.find((item) => wanted && UUID.test(wanted) && item.id === wanted) ?? state.lists[0];
  const items = state.items.filter((item) => !list || item.list_id === list.id);
  const origin = request.nextUrl.origin;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DːON";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("담은 매물", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "번호", key: "n", width: 7 },
    { header: "구", key: "gu", width: 10 },
    { header: "동", key: "dong", width: 14 },
    { header: "층", key: "floor", width: 9 },
    { header: "건물명", key: "name", width: 22 },
    { header: "주소", key: "address", width: 30 },
    { header: "전용면적(㎡)", key: "m2", width: 13 },
    { header: "전용면적(평)", key: "py", width: 13 },
    { header: "보증금(만원)", key: "deposit", width: 13 },
    { header: "월세(만원)", key: "rent", width: 12 },
    { header: "관리비(만원)", key: "fee", width: 13 },
    { header: "월세+관리비(만원)", key: "total", width: 18 },
    { header: "중개사 확인일", key: "confirmed", width: 15 },
    { header: "출처", key: "source", width: 13 },
    { header: "비고", key: "note", width: 26 },
    { header: "상세 보기", key: "link", width: 12 },
  ];

  items.forEach((item, index) => {
    const data = item.data;
    if (!item.available || !data) {
      sheet.addRow({ n: index + 1, name: "(이용할 수 없는 매물)", note: "게시가 끝났거나 지금은 볼 수 없어요" });
      return;
    }
    const notes = [
      data.maintenance_fee === null ? "관리비 미기재" : "",
      item.status && item.status !== "active" ? "게시 종료" : "",
      item.needs_check ? "확인 필요" : "",
    ].filter(Boolean);
    const row = sheet.addRow({
      n: index + 1,
      gu: data.gu ?? "",
      dong: data.dong ?? "",
      floor: data.floor ?? "",
      name: data.building_name ?? "",
      address: savedAddress(data),
      m2: data.area_m2 ?? null,
      py: data.area_m2 === null ? null : Math.round((data.area_m2 / SQM_PER_PYEONG) * 10) / 10,
      deposit: data.deposit,
      rent: data.rent,
      fee: data.maintenance_fee,
      // 월세와 관리비를 둘 다 알 때만 합친다(하나라도 없으면 비워 두고 비고에 적는다).
      total: data.rent !== null && data.maintenance_fee !== null ? data.rent + data.maintenance_fee : null,
      confirmed: savedDate(data.confirmed_at),
      source: savedSource(item.source),
      note: notes.join(" · "),
    });
    const link = row.getCell("link");
    link.value = { text: "열기", hyperlink: `${origin}/listings/${item.listing_id}` };
    link.font = { color: { argb: "FF0B57D0" }, underline: true };
  });

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F6FB" } };
  header.alignment = { vertical: "middle", horizontal: "center" };
  for (const key of ["m2", "py", "deposit", "rent", "fee", "total"]) {
    sheet.getColumn(key).numFmt = key === "py" ? "0.0" : "#,##0";
    sheet.getColumn(key).alignment = { horizontal: "right" };
  }

  const info = workbook.addWorksheet("안내");
  info.getColumn(1).width = 90;
  [
    `목록: ${list?.name ?? "담은 매물"}`,
    `내려받은 날: ${new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}`,
    "매물 정보는 네이버 부동산에 중개사가 올린 내용을 수집한 것으로, 실제와 다를 수 있어요.",
    "공실 여부와 조건은 계약 전에 원문과 현장에서 꼭 확인하세요.",
    "점수는 아직 준비 중이라 이 파일에 들어 있지 않아요.",
    "비어 있는 칸은 매물에 적혀 있지 않은 값이에요.",
  ].forEach((text) => info.addRow([text]));

  const buffer = await workbook.xlsx.writeBuffer();
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).replace(/-/g, "");
  const name = `DːON_담은매물_${day}.xlsx`;
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="DON_saved_${day}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
