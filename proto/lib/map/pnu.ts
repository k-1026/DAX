// 매물 좌표 → 필지 고유번호(PNU) → 토지이음 "토지이용계획 열람" 주소. (브라우저 전용, 카카오 지도 services 사용)
// 매물에는 지번이 없어서 좌표로 지번을 찾는다. 좌표가 건물 대표점이라 실제 지번과 다를 수 있다.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type ParcelLink = { url: string; jibun: string };

const EUM_DETAIL = "https://www.eum.go.kr/web/ar/lu/luLandDet.jsp";

export async function findParcel(kakao: any, lat: number, lng: number): Promise<ParcelLink | null> {
  const geocoder = new kakao.maps.services.Geocoder();
  const ok = kakao.maps.services.Status.OK;
  const [address, region] = await Promise.all([
    new Promise<any[] | null>((resolve) => geocoder.coord2Address(lng, lat, (res: any[], status: string) => resolve(status === ok ? res : null))),
    new Promise<any[] | null>((resolve) => geocoder.coord2RegionCode(lng, lat, (res: any[], status: string) => resolve(status === ok ? res : null))),
  ]);
  const jibun = address?.[0]?.address;
  const bcode: string | undefined = region?.find((item) => item.region_type === "B")?.code;
  if (!jibun || !bcode || !/^\d{10}$/.test(bcode) || !jibun.main_address_no) return null;
  const pad = (value: string) => String(Number(value || 0)).padStart(4, "0");
  // PNU = 법정동코드 10자리 + 대지(1)/산(2) + 본번 4자리 + 부번 4자리
  const pnu = `${bcode}${jibun.mountain_yn === "Y" ? "2" : "1"}${pad(jibun.main_address_no)}${pad(jibun.sub_address_no)}`;
  return { url: `${EUM_DETAIL}?pnu=${pnu}&mode=search&isNoScr=script&selGbn=umd`, jibun: jibun.address_name };
}
