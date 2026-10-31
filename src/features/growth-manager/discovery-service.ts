import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TikTokTokenService } from "../tiktok/services";
import { serverEnv } from "@/lib/server-env";
import { classifyAccount, type AccountObservation } from "./discovery";
import { collectManualPilotAnalytics } from "./manual-analytics";

const check = (error: unknown) => { if (error) throw new Error("DISCOVERY_STORAGE_UNAVAILABLE"); };
export interface StatsResult { identity: string; count: number; }
export async function fetchFollowerStats(token: string, request: typeof fetch = fetch): Promise<StatsResult> {
  const response = await request("https://open.tiktokapis.com/v2/user/info/?fields=open_id,follower_count", {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
  });
  // No raw upstream error or token is logged, persisted or sent to the client.
  if (!response.ok) throw new Error("FOLLOWER_SYNC_FAILED");
  const body = await response.json() as { error?: { code?: string }; data?: { user?: { open_id?: string; follower_count?: number } } };
  const user = body.data?.user;
  if (body.error?.code !== "ok" || !user?.open_id || !Number.isSafeInteger(user.follower_count) || user.follower_count! < 0) throw new Error("FOLLOWER_SYNC_FAILED");
  return { identity: user.open_id, count: user.follower_count! };
}

/** Claims one due account at a time with lease/CAS recovery; a wall-clock slice is not an account ceiling. */
export async function syncAutoDiscovery(admin: SupabaseClient, now = new Date(), deadline = Date.now() + 45000,
  readStats?: (owner: string, account: string) => Promise<StatsResult>) {
  let synced = 0;
  while (Date.now() < deadline) {
    const lease = randomUUID(), claimed = await admin.rpc("claim_auto_account_sync", { p_token: lease });
    if (claimed.error && ["42883", "PGRST202"].includes(claimed.error.code)) return { installed: false, synced: 0 };
    check(claimed.error); if (!claimed.data) break;
    const a = claimed.data as { owner: string; account: string; identity: string; previousMode: AccountObservation["previousMode"];
      optedIn: boolean; connected: boolean; scopes: string[]; commerce: AccountObservation["commerce"]; manualVideoIds?:string[] };
    let followers: AccountObservation["followers"] = null, failure = "FOLLOWERS_PERMISSION_REQUIRED";
    if (a.scopes.includes("user.info.stats") && a.scopes.includes("user.info.basic") && (readStats || serverEnv.tiktokProvider === "official")) {
      try {
        const stats = readStats ? await readStats(a.owner, a.account) : await fetchFollowerStats(await new TikTokTokenService(admin).getAccessToken(a.owner, a.account));
        followers = { ...stats, at: now.toISOString(), source: "TIKTOK_DISPLAY" };
        failure = stats.identity === a.identity ? "" : "FOLLOWER_IDENTITY_CONFLICT";
      } catch { failure = "FOLLOWER_SYNC_FAILED"; }
    }
    if(!readStats&&a.optedIn&&a.connected&&a.manualVideoIds?.length){
      try{await collectManualPilotAnalytics(admin,{...a,token:lease,ids:a.manualVideoIds},now);}catch{/* Keep metrics UNKNOWN/stale; never replace them with owner reports. */}
    }
    const result = classifyAccount({ ...a, followers }, now);
    const saved = await admin.rpc("record_auto_account_sync", { p_owner: a.owner, p_account: a.account,
      p_token: lease, p_result: { ...result, observedAt: followers?.at ?? null, failure } }); check(saved.error);
    if (saved.data) synced++;
  }
  return { installed: true, synced };
}

export async function accountAutoPermission(admin: SupabaseClient, owner: string, account: string) {
  const r = await admin.from("auto_account_discovery").select("mode,can_execute,affiliate_allowed,observed_at,valid_until,lease_expires_at")
    .eq("owner_id", owner).eq("tiktok_account_id", account).maybeSingle();
  // Until the prepared migration is installed, new automation cannot treat legacy default counts as verified.
  if (r.error && ["42P01", "PGRST205"].includes(r.error.code)) return null;
  check(r.error);
  if (!r.data || !r.data.can_execute || !r.data.observed_at || Date.parse(r.data.observed_at) < Date.now() - 86400000 ||
      Date.parse(r.data.observed_at) > Date.now() || !(Date.parse(r.data.valid_until)>Date.now()) || (r.data.lease_expires_at && Date.parse(r.data.lease_expires_at) > Date.now())) return null;
  return r.data as { mode: "GROWTH" | "AFFILIATE"; affiliate_allowed: boolean };
}
