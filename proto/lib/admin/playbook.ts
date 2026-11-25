// 관리자 "다음에 할 일 제안" 엔진. 화면마다 md 규칙표(상황 → 해석·할 일)를 읽고, 코드가 계산한 숫자(신호)로 조건을 맞춰 본다.
// AI 비용이 들지 않고 결과가 늘 같다. 나중에 실제 AI로 바꿀 때는 같은 md와 신호를 AI에게 주면 된다.
// 조건은 정해진 비교만 읽는 작은 해석기로 계산한다(md에 코드를 넣어도 실행되지 않는다).

export type Level = "now" | "soon" | "info";
export type Advice = { level: Level; title: string; reading: string; action: string };
export type SignalValue = number | string;
export type Signals = Record<string, SignalValue>;

type Rule = { title: string; level: Level; condition: string; reading: string; action: string; line: number };
export type Playbook = { constants: Record<string, number>; rules: Rule[]; fallback: Omit<Advice, "level"> | null; errors: string[] };

const LEVELS: Record<string, Level> = { "지금 확인": "now", "곧 점검": "soon", 참고: "info" };

// ---- md 읽기 ---------------------------------------------------------------------
export function parsePlaybook(source: string): Playbook {
  const book: Playbook = { constants: {}, rules: [], fallback: null, errors: [] };
  let section: { kind: "constants" | "rule" | "fallback" | "other"; title: string; line: number; fields: Record<string, string> } | null = null;

  const close = () => {
    if (!section) return;
    if (section.kind === "rule") {
      const { 수준, 조건, 해석, ["할 일"]: 할일 } = section.fields;
      const level = LEVELS[(수준 ?? "").trim()];
      if (!level) book.errors.push(`${section.line}줄 "${section.title}": 수준은 지금 확인 / 곧 점검 / 참고 중 하나여야 해요.`);
      else if (!조건 || !해석 || !할일) book.errors.push(`${section.line}줄 "${section.title}": 조건·해석·할 일이 모두 있어야 해요.`);
      else book.rules.push({ title: section.title, level, condition: 조건, reading: 해석, action: 할일, line: section.line });
    } else if (section.kind === "fallback") {
      const { 해석, ["할 일"]: 할일 } = section.fields;
      if (!해석 || !할일) book.errors.push(`${section.line}줄 "${section.title}": 해석과 할 일이 있어야 해요.`);
      else book.fallback = { title: section.title, reading: 해석, action: 할일 };
    }
    section = null;
  };

  source.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    const lineNo = index + 1;
    if (line.startsWith("## ")) {
      close();
      const heading = line.slice(3).trim();
      if (heading === "기준 숫자") section = { kind: "constants", title: heading, line: lineNo, fields: {} };
      else if (heading.startsWith("상황:")) section = { kind: "rule", title: heading.slice(3).trim(), line: lineNo, fields: {} };
      else if (heading.startsWith("기본:")) section = { kind: "fallback", title: heading.slice(3).trim(), line: lineNo, fields: {} };
      else section = { kind: "other", title: heading, line: lineNo, fields: {} };
      return;
    }
    if (!section || !line.startsWith("- ")) return;
    const body = line.slice(2);
    const at = body.indexOf(":");
    if (at < 0) return;
    const key = body.slice(0, at).trim();
    const value = body.slice(at + 1).trim();
    if (section.kind === "constants") {
      const number = Number(value);
      if (!key || !Number.isFinite(number)) book.errors.push(`${lineNo}줄: 기준 숫자는 "이름: 숫자" 모양이어야 해요.`);
      else book.constants[key] = number;
    } else if (section.kind === "rule" || section.kind === "fallback") {
      section.fields[key] = value;
    }
  });
  close();
  return book;
}

// ---- 조건 계산 (안전한 작은 해석기) -------------------------------------------------
type Token = { type: "num" | "id" | "op" | "kw"; text: string };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\d+(?:\.\d+)?)|([가-힣A-Za-z_][가-힣A-Za-z0-9_]*)|(>=|<=|==|!=|>|<|\+|-|\*|\/|\(|\)))/y;
  let position = 0;
  while (position < text.length) {
    pattern.lastIndex = position;
    const match = pattern.exec(text);
    if (!match) {
      if (text.slice(position).trim() === "") break;
      throw new Error(`읽을 수 없는 글자: "${text.slice(position, position + 8).trim()}"`);
    }
    position = pattern.lastIndex;
    if (match[1] !== undefined) tokens.push({ type: "num", text: match[1] });
    else if (match[2] !== undefined) tokens.push({ type: match[2] === "그리고" || match[2] === "또는" ? "kw" : "id", text: match[2] });
    else tokens.push({ type: "op", text: match[3] });
  }
  return tokens;
}

export function evaluateCondition(condition: string, context: Record<string, number>): boolean {
  const tokens = tokenize(condition);
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  const fail = (message: string): never => {
    throw new Error(message);
  };

  function or(): number {
    let value = and();
    while (peek()?.type === "kw" && peek().text === "또는") {
      take();
      const right = and();
      value = value || right ? 1 : 0;
    }
    return value;
  }
  function and(): number {
    let value = compare();
    while (peek()?.type === "kw" && peek().text === "그리고") {
      take();
      const right = compare();
      value = value && right ? 1 : 0;
    }
    return value;
  }
  function compare(): number {
    const left = sum();
    const token = peek();
    if (token?.type === "op" && [">=", "<=", "==", "!=", ">", "<"].includes(token.text)) {
      take();
      const right = sum();
      switch (token.text) {
        case ">=": return left >= right ? 1 : 0;
        case "<=": return left <= right ? 1 : 0;
        case "==": return left === right ? 1 : 0;
        case "!=": return left !== right ? 1 : 0;
        case ">": return left > right ? 1 : 0;
        default: return left < right ? 1 : 0;
      }
    }
    return left;
  }
  function sum(): number {
    let value = term();
    while (peek()?.type === "op" && (peek().text === "+" || peek().text === "-")) {
      const op = take().text;
      const right = term();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }
  function term(): number {
    let value = factor();
    while (peek()?.type === "op" && (peek().text === "*" || peek().text === "/")) {
      const op = take().text;
      const right = factor();
      if (op === "/" && right === 0) fail("0으로 나눌 수 없어요");
      value = op === "*" ? value * right : value / right;
    }
    return value;
  }
  function factor(): number {
    const token = take();
    if (!token) return fail("조건이 중간에 끝났어요");
    if (token.type === "num") return Number(token.text);
    if (token.type === "id") {
      if (!(token.text in context)) return fail(`알 수 없는 이름: ${token.text}`);
      return context[token.text];
    }
    if (token.type === "op" && token.text === "-") return -factor();
    if (token.type === "op" && token.text === "(") {
      const value = or();
      const close = take();
      if (!close || close.text !== ")") fail("괄호가 닫히지 않았어요");
      return value;
    }
    return fail(`여기에 올 수 없는 말: ${token.text}`);
  }

  const result = or();
  if (index < tokens.length) fail(`조건 끝에 남은 말: ${tokens[index].text}`);
  return result !== 0;
}

// ---- 문구 채우기 ------------------------------------------------------------------
function show(value: SignalValue): string {
  if (typeof value === "string") return value;
  return Number.isInteger(value) ? value.toLocaleString("ko-KR") : String(Math.round(value * 10) / 10);
}

export function fillText(template: string, signals: Signals, errors: string[], where: string): string {
  return template.replace(/\{([^{}]+)\}/g, (_, name: string) => {
    const key = name.trim();
    if (!(key in signals)) {
      errors.push(`${where}: 문구의 {${key}}는 알 수 없는 이름이에요.`);
      return "?";
    }
    return show(signals[key]);
  });
}

// ---- 한 화면 평가 -----------------------------------------------------------------
export function evaluatePlaybook(book: Playbook, signals: Signals): { advice: Advice[]; errors: string[] } {
  const errors = [...book.errors];
  const numbers: Record<string, number> = { ...book.constants };
  for (const [key, value] of Object.entries(signals)) if (typeof value === "number") numbers[key] = value;

  const advice: Advice[] = [];
  for (const rule of book.rules) {
    let matched = false;
    try {
      matched = evaluateCondition(rule.condition, numbers);
    } catch (error) {
      errors.push(`${rule.line}줄 "${rule.title}": 조건 오류 — ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
      continue;
    }
    if (!matched) continue;
    const merged: Signals = { ...book.constants, ...signals };
    advice.push({
      level: rule.level,
      title: rule.title,
      reading: fillText(rule.reading, merged, errors, `${rule.line}줄 "${rule.title}"`),
      action: fillText(rule.action, merged, errors, `${rule.line}줄 "${rule.title}"`),
    });
  }
  if (advice.length === 0 && book.fallback) {
    const merged: Signals = { ...book.constants, ...signals };
    advice.push({
      level: "info",
      title: book.fallback.title,
      reading: fillText(book.fallback.reading, merged, errors, "기본"),
      action: fillText(book.fallback.action, merged, errors, "기본"),
    });
  }
  const order: Record<Level, number> = { now: 0, soon: 1, info: 2 };
  advice.sort((a, b) => order[a.level] - order[b.level]);
  return { advice, errors };
}
