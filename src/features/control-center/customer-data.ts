import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/server-env";
import { customerPeriod, mapCustomerOverview, mapCustomerPostAccount } from "./customer-mapping";
import type { CustomerDataRecords } from "./customer-mapping";
import { observedPostEvents } from "./performance-events";

// Read-only owner-scoped projection. Paginate instead of silently truncating large accounts at 1,000 rows.
async function ownerRows<T>(client: SupabaseClient, owner: string, table: string, fields: string,
  dateColumn?: string, since?: string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < 30; page++) {
    let query = client.from(table).select(fields).eq("owner_id", owner).order("id").range(page * 1000, page * 1000 + 999);
    if (dateColumn && since) query = query.gte(dateColumn, since);
    const result = await query;
    if (result.error) throw new Error("customer_overview_unavailable");
    const batch = result.data as T[];
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
  throw new Error("customer_overview_window_too_large");
}
export async function readCustomerRecords(client: SupabaseClient, owner: string, now = new Date()): Promise<CustomerDataRecords> {
  const since = new Date(now); since.setUTCDate(since.getUTCDate() - 31); since.setUTCHours(0, 0, 0, 0);
  const window = since.toISOString();
  const [accounts, masters, variations, queues, jobs, products, runs, states, snapshots] = await Promise.all([
    ownerRows<CustomerDataRecords["accounts"][number]>(client, owner, "tiktok_accounts", "id,display_name,username,avatar_url,mode,authorization_status,account_status,daily_post_target,daily_post_hard_limit,daily_video_budget_usd,preferred_categories,is_mock,hidden_at"),
    ownerRows<CustomerDataRecords["masters"][number]>(client, owner, "master_videos", "id,tiktok_account_id,product_id,status,created_at,creative_project_id,selected_script_id,storage_path"),
    ownerRows<CustomerDataRecords["variations"][number]>(client, owner, "video_variations", "id,tiktok_account_id,product_id,status,created_at,creative_project_id,master_video_id,storage_path"),
    ownerRows<CustomerDataRecords["queues"][number]>(client, owner, "publishing_queue", "id,tiktok_account_id,video_id,video_kind,status,scheduled_for,published_at:completed_at,created_at,retry_count,max_retries,provider_publish_id,external_state"),
    ownerRows<CustomerDataRecords["jobs"][number]>(client, owner, "generation_jobs", "id,master_video_id,video_variation_id,status,completed_at", "completed_at", window),
    ownerRows<CustomerDataRecords["products"][number]>(client, owner, "products", "id,title,image_url"),
    ownerRows<CustomerDataRecords["runs"][number]>(client, owner, "auto_runs", "id,state,run_date,updated_at"),
    ownerRows<CustomerDataRecords["states"][number]>(client, owner, "auto_account_states", "id,auto_run_id,tiktok_account_id,state,current_step,desired_daily_posts,blockers_json,updated_at"),
    // Include historical baselines. A cumulative counter cannot provide a period total without them.
    ownerRows<CustomerDataRecords["snapshots"][number]>(client, owner, "video_analytics_snapshots", "id,tiktok_account_id,video_id,video_kind,product_id,source,source_snapshot_at,published_at,views,comments,clicks,orders,items_sold,gmv,commission,currency,creative_project_id,script_id,creative_angle_id"),
  ]);
  runs.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return { accounts, masters, variations, queues, jobs, products, runs, states, snapshots };
}
async function authenticatedRecords() {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login");
  return readCustomerRecords(client, data.user.id);
}
export async function getCustomerOverview(period: unknown = "today") {
  return mapCustomerOverview(await authenticatedRecords(), customerPeriod(period));
}
export async function getCustomerPostAccount(accountId: string, period: unknown = "today") {
  const retryAllowed = serverEnv.tiktokPublishingProvider === "official" && serverEnv.tiktokPublishingRealMode;
  return mapCustomerPostAccount(await authenticatedRecords(), accountId, customerPeriod(period), new Date(), retryAllowed);
}
/** Reuses persisted official observations; no simulated LIVE rows or new recommendation engine. */
export async function getObservedPerformanceEvents() {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login");
  const records = await readCustomerRecords(client, data.user.id);
  const ids = new Set(records.accounts.filter((row) => !row.is_mock && !row.hidden_at).map((row) => row.id));
  return observedPostEvents(data.user.id, ids, records.snapshots);
}
