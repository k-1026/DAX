// 프로필 사진. 사진이 없으면 이름 첫 글자를 넣은 기본 이미지를 보여 준다.
const COLORS = [
  "bg-blue-100 text-blue-800",
  "bg-green-100 text-green-800",
  "bg-amber-100 text-amber-900",
  "bg-pink-100 text-pink-800",
  "bg-purple-100 text-purple-800",
];

export function Avatar({ url, name, size = 40 }: { url?: string | null; name?: string | null; size?: number }) {
  const label = (name ?? "").trim();
  const initial = label ? Array.from(label)[0] : "?";
  const color = COLORS[Array.from(label).reduce((sum, ch) => sum + ch.codePointAt(0)!, 0) % COLORS.length];
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };

  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" style={style} className="shrink-0 rounded-full object-cover" />;
  }
  return (
    <span
      aria-hidden="true"
      style={style}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium ${color}`}
    >
      {initial}
    </span>
  );
}
