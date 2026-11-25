// 발표 데모의 큰 패널: 둥근 흰 상자, 제목 줄 + 구분선, 안에서 스크롤 (PC), 휴대폰은 그냥 이어서 보인다.
export function Panel({
  title,
  right,
  children,
  className = "",
  label,
  footer,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  label?: string;
  footer?: React.ReactNode;
}) {
  return (
    <section
      aria-label={label ?? title}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-3xl border border-line bg-panel ${className}`}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="text-sm font-medium">{title}</h2>
        {right}
      </div>
      <div className="min-h-0 flex-1 px-5 py-4 lg:overflow-y-auto">{children}</div>
      {footer && <div className="shrink-0 border-t border-line px-5 py-4">{footer}</div>}
    </section>
  );
}
