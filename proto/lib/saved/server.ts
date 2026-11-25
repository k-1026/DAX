import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SavedState } from "./types";

const EMPTY: SavedState = { ok: true, tier: "guest", saved_limit: 0, compare_limit: 0, lists: [], items: [], total: 0 };

export async function getSavedState(): Promise<SavedState> {
  const client = await createClient();
  const { data: auth } = await client.auth.getClaims();
  if (!auth?.claims) return EMPTY;
  const { data, error } = await client.rpc("saved_state");
  if (error || !data?.ok) return { ...EMPTY, ok: false, tier: "member" };
  return data as SavedState;
}
