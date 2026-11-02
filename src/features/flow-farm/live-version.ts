import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { flowLogins } from "./service";

/** Worker counts as online when it reported within this window (same rule as the /post page). */
const ONLINE_MS = 3 * 60_000;
const OPEN_STATUSES = ["QUEUED", "GENERATING", "READY", "SCHEDULED"];

/**
 * A short fingerprint of everything the clip pages show for one owner: open clips (queue + library), the most recent
 * clip change, linked Google accounts, their login state and whether the worker is online. Any change means the
 * browser should re-render. Reads only small columns so it can be polled every few seconds.
 */
export async function liveVersion(client: SupabaseClient, admin: SupabaseClient | null, owner: string, now = Date.now()) {
  const [open, latest, accounts, worker, logins] = await Promise.all([
    client.from("flow_clips").select("id,status,updated_at,scheduled_at").eq("owner_id", owner).in("status", OPEN_STATUSES)
      .order("id", { ascending: true }).limit(400),
    client.from("flow_clips").select("id,status,updated_at", { count: "exact" }).eq("owner_id", owner).order("updated_at", { ascending: false }).limit(1),
    client.from("flow_accounts").select("id,tiktok_account_id,priority,active,exhausted_on,clips_today,updated_at").eq("owner_id", owner)
      .order("id", { ascending: true }),
    client.from("flow_worker_status").select("last_seen_at").eq("owner_id", owner).maybeSingle(),
    admin ? flowLogins(admin, owner).catch(() => null) : Promise.resolve(null),
  ]);
  if (open.error || latest.error || accounts.error) throw new Error("live_version_unavailable");
  const lastSeen = (worker.data as { last_seen_at: string } | null)?.last_seen_at;
  const online = Boolean(lastSeen && now - Date.parse(lastSeen) < ONLINE_MS);
  const loginStates = logins ? Object.entries(logins).map(([id, entry]) => [id, entry.state, entry.note]).sort() : null;
  const payload = JSON.stringify([open.data, latest.data, latest.count, accounts.data, online, loginStates]);
  return createHash("sha1").update(payload).digest("base64url").slice(0, 16);
}
