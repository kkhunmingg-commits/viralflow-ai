import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bangkokDate } from "./contracts";
import { flowLogins, type FlowLogins } from "./service";

/**
 * Lucky, 8 Nov: one pool of Google accounts for all three clip modes (promo clips, product clips from a link, drama).
 * Each row is one account as the database's flow_pool_status() sees it today, with the computer's sign-in state.
 */
export interface PoolAccount {
  id: string; label: string; purpose: "CLIP" | "REPAIR"; tiktokAccountId: string | null; active: boolean; exhaustedToday: boolean;
  perDay: number; usedToday: number; leftToday: number; dramaReserved: number; freeToday: number;
  /** May make a promo / product clip right now (not kept for drama, not out of credits). */
  openForClips: boolean;
  loginState: "READY" | "FAILED" | "PENDING"; loginNote: string | null;
}
export interface PoolSummary { accounts: PoolAccount[]; dramaWaiting: number; episodeShots: number; usable: number; leftToday: number; openClips: number; keptForDrama: number }

interface PoolRow { flow_account_id: string; label: string; purpose: "CLIP" | "REPAIR"; tiktok_account_id: string | null; active: boolean; exhausted_today: boolean;
  per_day: number; used_today: number; left_today: number; drama_reserved: number; free_today: number; drama_waiting: number; episode_shots: number; open_clip: boolean }

/** Signed in only once the computer said so: the worker makes clips only with those accounts. */
function loginOf(logins: FlowLogins, id: string): PoolAccount["loginState"] {
  return logins[id]?.state ?? "PENDING";
}

export function summarizePool(rows: PoolRow[], logins: FlowLogins): PoolSummary {
  const accounts = rows.map(row => {
    const loginState = loginOf(logins, row.flow_account_id), signedIn = loginState === "READY";
    return { id: row.flow_account_id, label: row.label, purpose: row.purpose, tiktokAccountId: row.tiktok_account_id, active: row.active,
      exhaustedToday: row.exhausted_today, perDay: row.per_day, usedToday: row.used_today, leftToday: signedIn ? row.left_today : 0,
      dramaReserved: row.drama_reserved, freeToday: signedIn ? row.free_today : 0, openForClips: signedIn && row.open_clip,
      loginState, loginNote: logins[row.flow_account_id]?.note ?? null };
  }).toSorted((a, b) => Number(b.active) - Number(a.active) || b.leftToday - a.leftToday || a.label.localeCompare(b.label));
  const usable = accounts.filter(a => a.active && a.loginState === "READY" && a.leftToday > 0);
  return { accounts, dramaWaiting: rows[0]?.drama_waiting ?? 0, episodeShots: rows[0]?.episode_shots ?? 4, usable: usable.length,
    leftToday: usable.reduce((sum, a) => sum + a.leftToday, 0), openClips: accounts.filter(a => a.openForClips).reduce((sum, a) => sum + a.freeToday, 0),
    keptForDrama: accounts.filter(a => a.active && a.loginState === "READY" && !a.exhaustedToday && !a.openForClips).reduce((sum, a) => sum + a.leftToday, 0) };
}

/** Before the pool migration is applied: the same numbers from the account rows alone (no drama reservation). */
async function fallbackRows(admin: SupabaseClient, owner: string, now: Date): Promise<PoolRow[]> {
  const today = bangkokDate(now);
  const rows = ((await admin.from("flow_accounts").select("id,label,purpose,tiktok_account_id,active,exhausted_on,clips_today,clips_today_on,clips_per_day_estimate")
    .eq("owner_id", owner)).data ?? []) as Array<{ id: string; label: string; purpose: "CLIP" | "REPAIR" | null; tiktok_account_id: string | null; active: boolean;
      exhausted_on: string | null; clips_today: number; clips_today_on: string | null; clips_per_day_estimate: number }>;
  return rows.map(r => {
    const perDay = Math.max(1, r.clips_per_day_estimate), used = r.clips_today_on === today ? r.clips_today : 0, exhausted = r.exhausted_on === today;
    const left = !r.active || exhausted ? 0 : Math.max(0, perDay - used);
    return { flow_account_id: r.id, label: r.label, purpose: r.purpose ?? "CLIP", tiktok_account_id: r.tiktok_account_id, active: r.active, exhausted_today: exhausted,
      per_day: perDay, used_today: used, left_today: left, drama_reserved: 0, free_today: left, drama_waiting: 0, episode_shots: 4, open_clip: r.active && !exhausted };
  });
}

export async function flowPool(admin: SupabaseClient, owner: string, now = new Date()): Promise<PoolSummary> {
  const [result, logins] = await Promise.all([admin.rpc("flow_pool_status", { p_owner: owner }), flowLogins(admin, owner).catch(() => ({} as FlowLogins))]);
  const rows = result.error ? await fallbackRows(admin, owner, now) : (result.data ?? []) as PoolRow[];
  return summarizePool(rows, logins);
}
