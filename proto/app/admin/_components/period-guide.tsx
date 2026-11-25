// 기간 버튼 아래에 "기간별로 무엇을 알 수 있는지"를 보여 준다. AI 사용량·사용자 현황 화면이 같이 쓴다. 지금 고른 기간은 강조한다.
export type PeriodRow = { days: number; text: string };

export function PeriodGuide({ rows, current }: { rows: PeriodRow[]; current: number }) {
  return (
    <div className="basis-full overflow-x-auto">
      <table className="w-full border-collapse text-left text-[0.8125rem]">
        <caption className="sr-only">기간별로 알 수 있는 것</caption>
        <thead>
          <tr className="text-faint">
            <th scope="col" className="w-16 border-b border-line px-2 py-1.5 font-normal">기간</th>
            <th scope="col" className="border-b border-line px-2 py-1.5 font-normal">알 수 있는 것</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.days} className={row.days === current ? "bg-soft" : ""} aria-current={row.days === current ? "true" : undefined}>
              <td className="border-b border-line px-2 py-2 align-top font-medium">{row.days}일</td>
              <td className="border-b border-line px-2 py-2 text-muted">{row.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
