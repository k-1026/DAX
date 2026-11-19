// 발표용 단일 HTML에는 다른 페이지가 없으므로, 링크를 누르면 화면 안 동작으로 바꾼다.
import type { AnchorHTMLAttributes } from "react";

export default function Link({ href, children, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        e.preventDefault();
        if (href === "/login") window.dispatchEvent(new CustomEvent("demo-login"));
        else if (href !== "/") window.dispatchEvent(new CustomEvent("demo-toast", { detail: "발표용 데모에서는 이 화면을 열 수 없어요." }));
      }}
    >
      {children}
    </a>
  );
}
