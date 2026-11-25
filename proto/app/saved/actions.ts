"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";
import type { SavedResult } from "@/lib/saved/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGES: Record<string, string> = {
  login_required: "로그인 후 이용할 수 있어요.",
  saved_limit: "담기 한도에 도달했어요. 담은 매물을 빼고 다른 매물을 담아 주세요.",
  list_limit: "무료 회원은 담기 목록 1개를 이용할 수 있어요. 기존 목록을 선택해 주세요.",
  compare_limit: "한 번에 비교할 수 있는 개수를 넘었어요. 비교 대상을 줄여 주세요.",
  choose_two: "비교할 매물을 2곳 이상 골라 주세요.",
  not_saved: "담은 매물 중에서 비교 대상을 골라 주세요.",
  not_available: "지금은 이용할 수 없는 매물이에요. 담은 매물 목록을 확인해 주세요.",
  not_found: "목록을 찾을 수 없어요. 새로고침 후 다시 시도해 주세요.",
  name: "목록 이름을 1~50자로 입력해 주세요.",
};
const FAILED: SavedResult = { ok: false, message: "처리하지 못했어요. 잠시 후 다시 시도해 주세요." };

async function callSaved(name: string, args: Record<string, unknown>): Promise<SavedResult> {
  const client = await createClient();
  const { data: auth } = await client.auth.getClaims();
  if (!auth?.claims) return { ok: false, message: MESSAGES.login_required };
  const { data: agreed, error: consentError } = await client.rpc("has_required_consents", {
    terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy,
  });
  if (consentError || !agreed) return { ok: false, message: "필수 약관 동의를 확인한 뒤 이용해 주세요." };
  const { data, error } = await client.rpc(name, args);
  if (error || !data) return FAILED;
  if (!data.ok) return { ok: false, message: MESSAGES[data.error] ?? FAILED.message };
  return data as SavedResult;
}

export async function setSaved(listingId: string, saved: boolean, listId: string | null): Promise<SavedResult> {
  if (!UUID.test(listingId) || (listId !== null && !UUID.test(listId)) || typeof saved !== "boolean") return FAILED;
  const result = await callSaved("saved_set", { p_listing: listingId, p_saved: saved, p_list: listId });
  if (result.ok) {
    revalidatePath("/");
    revalidatePath(`/listings/${listingId}`);
  }
  return result;
}

export async function createSavedList(name: string): Promise<SavedResult> {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 50) return { ok: false, message: MESSAGES.name };
  const result = await callSaved("saved_list_create", { p_name: name.trim() });
  if (result.ok) revalidatePath("/");
  return result;
}

export async function compareSaved(ids: string[]): Promise<SavedResult> {
  if (!Array.isArray(ids) || ids.length > 50 || !ids.every((id) => typeof id === "string" && UUID.test(id))) return FAILED;
  return callSaved("saved_compare", { p_ids: [...new Set(ids)] });
}
