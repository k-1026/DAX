// 약관과 개인정보 처리방침의 본문을 화면에 표시한다.
import { SiteLogo } from "@/app/_components/site-logo";
import Link from "next/link";
import type { ReactNode } from "react";

type Block =
  | { type: "h1" | "h2" | "p"; text: string }
  | { type: "table"; rows: string[][] }
  | { type: "ol"; items: { value: number; text: string; children: string[] }[] }
  | { type: "ul"; items: string[] };

function parse(source: string): Block[] {
  const blocks: Block[] = [];
  for (const line of source.split("\n")) {
    const last = blocks[blocks.length - 1];
    const ordered = line.match(/^(\d+)\. (.*)$/);
    const nested = line.match(/^\s+- (.*)$/);

    if (!line.trim()) continue;
    if (line.startsWith("# ")) blocks.push({ type: "h1", text: line.slice(2) });
    else if (line.startsWith("## ")) blocks.push({ type: "h2", text: line.slice(3) });
    else if (line.startsWith("|")) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue;
      const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
      if (last?.type === "table") last.rows.push(cells);
      else blocks.push({ type: "table", rows: [cells] });
    } else if (ordered) {
      const item = { value: Number(ordered[1]), text: ordered[2], children: [] };
      if (last?.type === "ol") last.items.push(item);
      else blocks.push({ type: "ol", items: [item] });
    } else if (nested && last?.type === "ol") {
      last.items[last.items.length - 1].children.push(nested[1]);
    } else if (line.startsWith("- ")) {
      if (last?.type === "ul") last.items.push(line.slice(2));
      else blocks.push({ type: "ul", items: [line.slice(2)] });
    } else blocks.push({ type: "p", text: line });
  }
  return blocks;
}

function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .map((part, index) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : (
        part
      ),
    );
}

function renderBlock(block: Block, index: number) {
  switch (block.type) {
    case "h1":
      return (
        <h1 key={index} className="text-2xl font-medium">
          {block.text}
        </h1>
      );
    case "h2":
      return (
        <h2 key={index} className="mt-4 text-lg font-medium">
          {block.text}
        </h2>
      );
    case "p":
      return <p key={index}>{inline(block.text)}</p>;
    case "ul":
      return (
        <ul key={index} className="list-disc space-y-1 pl-5">
          {block.items.map((item) => (
            <li key={item}>{inline(item)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={index} className="list-decimal space-y-1 pl-5">
          {block.items.map((item) => (
            <li key={item.value} value={item.value}>
              {inline(item.text)}
              {item.children.length > 0 && (
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {item.children.map((child) => (
                    <li key={child}>{inline(child)}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div key={index} className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                {block.rows[0].map((cell) => (
                  <th
                    key={cell}
                    scope="col"
                    className="border border-zinc-300 bg-zinc-100 px-3 py-2 font-medium dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.slice(1).map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="border border-zinc-300 px-3 py-2 align-top dark:border-zinc-700"
                    >
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function LegalDocument({ source }: { source: string }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <SiteLogo />
        <Link href="/" className="rounded-full border border-line bg-panel px-3.5 py-2 text-sm hover:bg-soft">
          첫 화면
        </Link>
      </div>
      <article className="card flex flex-col gap-3 p-6 text-sm leading-7">
        <p
          role="note"
          className="rounded-xl bg-warn-soft px-4 py-3 font-medium text-warn"
        >
          임시 문구입니다. 법률 검토를 마친 뒤 정식 문구로 교체합니다.
        </p>
        {parse(source).map(renderBlock)}
      </article>
    </main>
  );
}
