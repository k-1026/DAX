// 묶음 메일: 내용 만들기, 야간 발송 제한, 발송 순서
// 규칙: 앱 개발/04_회원_동의_권한_규칙.md 8절

export type MailCall = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  // 같은 값으로 24시간 안에 다시 보내면 Resend가 한 번만 발송한다.
  idempotencyKey?: string;
};

export type DeliveryResult = { status: "sent" | "preview"; id?: string };

export type MailDeps = {
  deliver: (message: MailMessage) => Promise<DeliveryResult>;
  unsubscribeUrl: (userId: string) => string;
  siteUrl: string;
  contact: string;
  now?: () => Date;
};

type ListingCard = {
  listing_id: string;
  data: Record<string, unknown>;
  fields?: Record<string, { before: unknown; after: unknown }>;
};

export type BatchRecipient = {
  user_id: string;
  to: string;
  used: number;
  month_limit: number;
  new: ListingCard[];
  new_total: number;
  changed: ListingCard[];
  sold: ListingCard[];
};

const SERVICE_NAME = "대구 공실 매칭";
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const QUIET_START_HOUR = 21;
const QUIET_END_HOUR = 8;

// 밤 9시부터 아침 8시까지는 보내지 않고 다음 아침 8시로 미룬다.
export function nextAllowedSendTime(now: Date): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const hour = kst.getUTCHours();
  if (hour >= QUIET_END_HOUR && hour < QUIET_START_HOUR) return now;

  const target = new Date(kst);
  if (hour >= QUIET_START_HOUR) target.setUTCDate(target.getUTCDate() + 1);
  target.setUTCHours(QUIET_END_HOUR, 0, 0, 0);
  return new Date(target.getTime() - KST_OFFSET_MS);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeLink(value: unknown) {
  const url = String(value ?? "");
  return /^https?:\/\//i.test(url) ? url : "";
}

function describe(card: ListingCard) {
  const d = card.data;
  return `${d.gu ?? ""} ${d.dong ?? ""} ${d.floor ?? ""} · 보증금 ${d.deposit ?? "-"}만원 / 월세 ${d.rent ?? "-"}만원`.trim();
}

function describeChange(card: ListingCard) {
  const labels: Record<string, string> = { rent: "월세", deposit: "보증금", status: "상태" };
  return Object.entries(card.fields ?? {})
    .filter(([key]) => labels[key])
    .map(([key, change]) => `${labels[key]} ${change.before ?? "-"} → ${change.after ?? "-"}`)
    .join(", ");
}

function footer(deps: MailDeps, userId: string) {
  const unsubscribe = deps.unsubscribeUrl(userId);
  return {
    html: `<hr style="margin:24px 0;border:0;border-top:1px solid #ddd">
<p style="font-size:12px;color:#555;line-height:1.6">이 메일은 수신에 동의한 회원에게 발송되었습니다.<br>
발신: ${SERVICE_NAME} · 문의: ${escapeHtml(deps.contact)}<br>
<a href="${escapeHtml(unsubscribe)}">수신 거부</a></p>`,
    text: `\n--\n이 메일은 수신에 동의한 회원에게 발송되었습니다.\n발신: ${SERVICE_NAME} / 문의: ${deps.contact}\n수신 거부: ${unsubscribe}\n`,
  };
}

function section(title: string, cards: ListingCard[], line: (card: ListingCard) => string) {
  if (cards.length === 0) return { html: "", text: "" };
  const items = cards
    .map((card) => {
      const label = escapeHtml(line(card));
      const url = safeLink(card.data.url);
      return `<li style="margin:6px 0">${url ? `<a href="${escapeHtml(url)}">${label}</a>` : label}</li>`;
    })
    .join("");
  return {
    html: `<h2 style="font-size:16px;margin:20px 0 8px">${escapeHtml(title)}</h2><ul style="padding-left:18px">${items}</ul>`,
    text: `\n[${title}]\n${cards.map((card) => `- ${line(card)}`).join("\n")}\n`,
  };
}

export function buildBatchMail(recipient: BatchRecipient, deps: MailDeps): MailMessage {
  const counts = [
    recipient.new_total > 0 ? `새 매물 ${recipient.new_total}곳` : "",
    recipient.changed.length > 0 ? `관심 매물 변동 ${recipient.changed.length}건` : "",
    recipient.sold.length > 0 ? `게시 종료 ${recipient.sold.length}건` : "",
  ].filter(Boolean);

  const parts = [
    section("새로 뜬 원하는 매물 (구독 회원 24시간 먼저 공개)", recipient.new, describe),
    section("관심 매물 변동", recipient.changed, (card) => `${describe(card)} (${describeChange(card) || "조건 변경"})`),
    section("게시가 끝난 관심 매물 (거래 완료 또는 게시 내림)", recipient.sold, describe),
  ];

  const more = recipient.new_total - recipient.new.length;
  const remaining = Math.max(recipient.month_limit - recipient.used - 1, 0);
  const end = footer(deps, recipient.user_id);
  const settings = `${deps.siteUrl}/mypage`;

  return {
    to: recipient.to,
    subject: `(광고) ${counts.join(", ")}`,
    html: `<div style="font-family:sans-serif;color:#222;max-width:560px">
<h1 style="font-size:20px">${SERVICE_NAME} 새 소식</h1>
${parts.map((part) => part.html).join("")}
${more > 0 ? `<p><a href="${escapeHtml(deps.siteUrl)}">새 매물 ${more}곳 더 보기</a></p>` : ""}
<p style="font-size:13px;color:#555">이번 달 남은 알림: ${remaining}통 · <a href="${escapeHtml(settings)}">알림 조건 변경</a></p>
${end.html}</div>`,
    text: `${SERVICE_NAME} 새 소식\n${parts.map((part) => part.text).join("")}${more > 0 ? `\n새 매물 ${more}곳 더 보기: ${deps.siteUrl}\n` : ""}\n이번 달 남은 알림: ${remaining}통\n알림 조건 변경: ${settings}\n${end.text}`,
    headers: {
      "List-Unsubscribe": `<${deps.unsubscribeUrl(recipient.user_id)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

export function buildUnsubscribeResult(to: string, deps: Pick<MailDeps, "contact">): MailMessage {
  const body = "추천 메일 수신 거부가 처리되었습니다. 앞으로 추천 메일을 보내지 않습니다.";
  return {
    to,
    subject: `[${SERVICE_NAME}] 수신 거부 처리 결과 안내`,
    html: `<div style="font-family:sans-serif;color:#222"><p>${body}</p><p style="font-size:12px;color:#555">발신: ${SERVICE_NAME} · 문의: ${escapeHtml(deps.contact)}</p></div>`,
    text: `${body}\n발신: ${SERVICE_NAME} / 문의: ${deps.contact}\n`,
  };
}

export function buildConsentReminder(
  to: string,
  agreedAt: string,
  userId: string,
  deps: MailDeps,
): MailMessage {
  const date = new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeZone: "Asia/Seoul" }).format(new Date(agreedAt));
  const body = `회원님은 ${date}에 추천 메일 수신에 동의하셨습니다. 수신 동의를 유지하려면 별도로 하실 일은 없습니다.`;
  const end = footer(deps, userId);
  return {
    to,
    subject: `[${SERVICE_NAME}] 추천 메일 수신 동의 안내`,
    html: `<div style="font-family:sans-serif;color:#222"><p>${escapeHtml(body)}</p>${end.html}</div>`,
    text: `${body}\n${end.text}`,
  };
}

// 갱신 1회의 묶음 메일을 보낸다. 한 명이 실패해도 나머지 회원에게는 계속 보낸다.
export async function sendBatchMails(call: MailCall, runId: string, deps: MailDeps) {
  const recipients = (await call("mail_collect_batch", { p_run: runId })) as BatchRecipient[];
  const now = (deps.now ?? (() => new Date()))();
  const result = { recipients: recipients.length, sent: 0, preview: 0, deferred: 0, failed: 0, capped: 0 };

  for (const recipient of recipients) {
    const message = buildBatchMail(recipient, deps);
    const sendAt = nextAllowedSendTime(now);
    const deferred = sendAt.getTime() > now.getTime();
    const items = [
      ...recipient.new.map((card) => ({ listing_id: card.listing_id, section: "new" })),
      ...recipient.changed.map((card) => ({ listing_id: card.listing_id, section: "changed" })),
      ...recipient.sold.map((card) => ({ listing_id: card.listing_id, section: "sold" })),
    ];

    const sendId = await call("mail_record_send", {
      p_user: recipient.user_id,
      p_kind: "subscriber_batch",
      p_run: runId,
      p_to: recipient.to,
      p_subject: message.subject,
      p_status: deferred ? "deferred" : "queued",
      p_scheduled: deferred ? sendAt.toISOString() : null,
      p_payload: deferred ? message : null,
      p_items: items,
    });
    if (!sendId) {
      result.capped += 1;
      continue;
    }
    if (deferred) {
      result.deferred += 1;
      continue;
    }

    try {
      const delivery = await deps.deliver(message);
      await call("mail_mark_result", { p_send: sendId, p_status: delivery.status, p_resend_id: delivery.id ?? null });
      result[delivery.status] += 1;
    } catch (cause) {
      await call("mail_mark_result", {
        p_send: sendId,
        p_status: "failed",
        p_error: cause instanceof Error ? cause.message : String(cause),
      });
      result.failed += 1;
    }
  }
  return result;
}

// ---- 첫 추천 메일(M01) -----------------------------------------------------------
export type FirstRecipient = {
  user_id: string;
  to: string;
  filters: Record<string, unknown>;
  total: number;
  items: ListingCard[];
};

const num = (value: unknown) => (typeof value === "number" ? value : null);
const wonText = (value: unknown) => (typeof value === "number" ? `${value.toLocaleString("ko-KR")}만원` : "-");

// 선호 조건 한 줄 ("수성구 · 월세+관리비 200만원 이하" 같은 글)
export function firstMailConditionLine(filters: Record<string, unknown>) {
  const parts: string[] = [];
  const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
  if (list(filters.gu).length) parts.push(list(filters.gu).join("·"));
  if (list(filters.dong).length) parts.push(list(filters.dong).join("·"));
  const areaMin = num(filters.area_min);
  const areaMax = num(filters.area_max);
  const pyeong = (sqm: number) => Math.round(sqm / 3.3058);
  if (areaMin !== null && areaMax !== null) parts.push(`${pyeong(areaMin)}~${pyeong(areaMax)}평`);
  else if (areaMin !== null) parts.push(`${pyeong(areaMin)}평 이상`);
  else if (areaMax !== null) parts.push(`${pyeong(areaMax)}평 이하`);
  if (num(filters.deposit_max) !== null) parts.push(`보증금 ${wonText(filters.deposit_max)} 이하`);
  if (num(filters.rent_max) !== null) parts.push(`월세+관리비 ${wonText(filters.rent_max)} 이하`);
  return parts.join(" · ") || "저장한 선호 조건";
}

function firstQuery(filters: Record<string, unknown>) {
  const query = new URLSearchParams();
  const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
  for (const gu of list(filters.gu)) query.append("gu", gu);
  for (const dong of list(filters.dong)) query.append("dong", dong);
  for (const key of ["rent_max", "deposit_max", "area_min", "area_max"]) {
    const value = num(filters[key]);
    if (value !== null) query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

// 첫 추천 메일: 선호 조건에 맞는 매물 상위 5곳(점수 연결 전에는 최근 확인순). 제목 (광고) 표시와 수신 거부 링크를 넣는다.
export function buildFirstMail(recipient: FirstRecipient, deps: MailDeps): MailMessage {
  const end = footer(deps, recipient.user_id);
  const condition = firstMailConditionLine(recipient.filters);
  const moreCount = Math.max(recipient.total - recipient.items.length, 0);
  const searchUrl = `${deps.siteUrl}/${firstQuery(recipient.filters)}`;
  const settings = `${deps.siteUrl}/mypage`;

  const rows = recipient.items
    .map((card) => {
      const d = card.data;
      const title = escapeHtml([d.gu, d.dong, d.floor].filter(Boolean).join(" "));
      const area = typeof d.area_m2 === "number" ? ` · 전용 ${d.area_m2}㎡(약 ${Math.round(d.area_m2 / 3.3058)}평)` : "";
      const price = `보증금 ${escapeHtml(wonText(d.deposit))} / 월세 ${escapeHtml(wonText(d.rent))}${area}`;
      return `<li style="margin:0 0 10px;padding:12px 14px;background:#f3f6fb;border-radius:12px;list-style:none">
<a href="${escapeHtml(`${deps.siteUrl}/listings/${card.listing_id}`)}" style="color:#0b57d0;font-weight:500;text-decoration:none">${title}</a>
<div style="font-size:13px;color:#5f6368;margin-top:4px">${price}</div></li>`;
    })
    .join("");
  const textRows = recipient.items
    .map((card) => {
      const d = card.data;
      return `- ${[d.gu, d.dong, d.floor].filter(Boolean).join(" ")} · 보증금 ${wonText(d.deposit)} / 월세 ${wonText(d.rent)}\n  ${deps.siteUrl}/listings/${card.listing_id}`;
    })
    .join("\n");

  return {
    to: recipient.to,
    subject: `(광고) 선호 조건에 맞는 공실 ${recipient.total.toLocaleString("ko-KR")}곳을 찾았어요`,
    html: `<div style="background:#eef2f8;padding:24px 12px;font-family:sans-serif;color:#1f1f1f">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:20px;padding:24px">
<p style="margin:0 0 4px;font-size:13px;color:#5f6368">${SERVICE_NAME}</p>
<h1 style="font-size:20px;margin:0 0 6px">선호 조건에 맞는 공실을 찾았어요</h1>
<p style="margin:0 0 16px;font-size:13px;color:#5f6368">${escapeHtml(condition)} · 모두 ${recipient.total.toLocaleString("ko-KR")}곳</p>
<ul style="padding:0;margin:0 0 12px">${rows}</ul>
${moreCount > 0 ? `<p style="margin:0 0 12px"><a href="${escapeHtml(searchUrl)}" style="color:#0b57d0">나머지 ${moreCount.toLocaleString("ko-KR")}곳 더 보기</a></p>` : ""}
<p style="margin:16px 0 0"><a href="${escapeHtml(searchUrl)}" style="display:inline-block;background:#1f1f1f;color:#ffffff;padding:10px 20px;border-radius:999px;text-decoration:none;font-size:14px">조건으로 검색하기</a></p>
<p style="margin:16px 0 0;font-size:12px;color:#8a9099">이 메일은 가입 후 한 번만 보내는 첫 추천 메일이에요. 매물 정보는 중개사가 올린 내용을 수집한 것이라 실제와 다를 수 있어요. 계약 전에 원문과 현장에서 꼭 확인하세요. <a href="${escapeHtml(settings)}" style="color:#8a9099">선호 조건 변경</a></p>
${end.html}</div></div>`,
    text: `${SERVICE_NAME}\n선호 조건에 맞는 공실을 찾았어요\n${condition} · 모두 ${recipient.total}곳\n\n${textRows}\n${moreCount > 0 ? `\n나머지 ${moreCount}곳 더 보기: ${searchUrl}\n` : ""}\n이 메일은 가입 후 한 번만 보내는 첫 추천 메일이에요.\n선호 조건 변경: ${settings}\n${end.text}`,
    headers: {
      "List-Unsubscribe": `<${deps.unsubscribeUrl(recipient.user_id)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

// 첫 추천 메일을 보낸다. 회원마다 한 번만(자격을 먼저 가져가고 보낸다). 밤에는 미뤘다가 아침에 보낸다.
export async function sendFirstRecommendations(call: MailCall, deps: MailDeps) {
  const recipients = (await call("mail_first_collect", {})) as FirstRecipient[];
  const now = (deps.now ?? (() => new Date()))();
  const result = { first_recipients: recipients.length, first_sent: 0, first_preview: 0, first_deferred: 0, first_failed: 0 };

  for (const recipient of recipients) {
    const claimed = (await call("mail_first_claim", { p_user: recipient.user_id })) as boolean;
    if (!claimed) continue;

    const message = buildFirstMail(recipient, deps);
    const sendAt = nextAllowedSendTime(now);
    const deferred = sendAt.getTime() > now.getTime();
    const sendId = await call("mail_record_send", {
      p_user: recipient.user_id,
      p_kind: "first_recommendation",
      p_run: null,
      p_to: recipient.to,
      p_subject: message.subject,
      p_status: deferred ? "deferred" : "queued",
      p_scheduled: deferred ? sendAt.toISOString() : null,
      p_payload: deferred ? message : null,
      p_items: recipient.items.map((card) => ({ listing_id: card.listing_id, section: "new" })),
    });
    if (!sendId) continue;
    if (deferred) {
      result.first_deferred += 1;
      continue;
    }
    try {
      const delivery = await deps.deliver(message);
      await call("mail_mark_result", { p_send: sendId, p_status: delivery.status, p_resend_id: delivery.id ?? null });
      if (delivery.status === "sent") result.first_sent += 1;
      else result.first_preview += 1;
    } catch (cause) {
      await call("mail_mark_result", { p_send: sendId, p_status: "failed", p_error: cause instanceof Error ? cause.message : String(cause) });
      result.first_failed += 1;
    }
  }
  return result;
}

// 야간이라 미뤄 둔 메일과 2년 주기 수신 동의 안내를 보낸다.
export async function runMailMaintenance(call: MailCall, deps: MailDeps) {
  const now = (deps.now ?? (() => new Date()))();
  const first = await sendFirstRecommendations(call, deps);
  const result = { deferred_sent: 0, deferred_failed: 0, reminders: 0, ...first };
  if (nextAllowedSendTime(now).getTime() > now.getTime()) return result;

  const due = (await call("mail_due_deferred", {})) as { id: string; payload: MailMessage }[];
  for (const mail of due) {
    try {
      const delivery = await deps.deliver(mail.payload);
      await call("mail_mark_result", { p_send: mail.id, p_status: delivery.status, p_resend_id: delivery.id ?? null });
      result.deferred_sent += 1;
    } catch (cause) {
      await call("mail_mark_result", {
        p_send: mail.id,
        p_status: "failed",
        p_error: cause instanceof Error ? cause.message : String(cause),
      });
      result.deferred_failed += 1;
    }
  }

  const reminders = (await call("mail_due_consent_reminders", {})) as {
    user_id: string;
    to: string;
    agreed_at: string;
  }[];
  for (const reminder of reminders) {
    const message = buildConsentReminder(reminder.to, reminder.agreed_at, reminder.user_id, deps);
    const sendId = await call("mail_record_send", {
      p_user: reminder.user_id,
      p_kind: "consent_reminder",
      p_run: null,
      p_to: reminder.to,
      p_subject: message.subject,
      p_status: "queued",
    });
    const delivery = await deps.deliver(message);
    await call("mail_mark_result", { p_send: sendId, p_status: delivery.status, p_resend_id: delivery.id ?? null });
    await call("mail_mark_reminded", { p_user: reminder.user_id });
    result.reminders += 1;
  }
  return result;
}
