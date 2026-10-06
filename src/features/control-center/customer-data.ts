import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/server-env";
import { customerPeriod, mapCustomerOverview, mapCustomerPostAccount } from "./customer-mapping";
import type { CustomerDataRecords } from "./customer-mapping";
import { observedPostEvents } from "./performance-events";
import { accountPostingMode } from "@/features/auto/execution-policy";

// Read-only owner-scoped projection. Paginate instead of silently truncating large accounts at 1,000 rows.
async function ownerRows<T>(client: SupabaseClient, owner: string, table: string, fields: string,
  dateColumn?: string, since?: string, orderColumn = "id"): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < 30; page++) {
    let query = client.from(table).select(fields).eq("owner_id", owner).order(orderColumn).range(page * 1000, page * 1000 + 999);
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
  const [accounts, masters, variations, queues, jobs, products, runs, states, snapshots, schedules, outputs] = await Promise.all([
    ownerRows<CustomerDataRecords["accounts"][number]>(client, owner, "tiktok_accounts", "id,display_name,username,avatar_url,mode,authorization_status,account_status,daily_post_target,daily_post_hard_limit,daily_video_budget_usd,preferred_categories,is_mock,hidden_at,audit_status,direct_post_status,granted_scopes,upload_status"),
    ownerRows<CustomerDataRecords["masters"][number]>(client, owner, "master_videos", "id,tiktok_account_id,product_id,status,created_at,creative_project_id,selected_script_id,storage_path"),
    ownerRows<CustomerDataRecords["variations"][number]>(client, owner, "video_variations", "id,tiktok_account_id,product_id,status,created_at,creative_project_id,master_video_id,storage_path"),
    ownerRows<CustomerDataRecords["queues"][number]>(client, owner, "publishing_queue", "id,tiktok_account_id,video_id,video_kind,status,caption_snapshot,scheduled_for,published_at:completed_at,created_at,retry_count,max_retries,provider_publish_id,external_state"),
    ownerRows<CustomerDataRecords["jobs"][number]>(client, owner, "generation_jobs", "id,master_video_id,video_variation_id,status,completed_at"),
    ownerRows<CustomerDataRecords["products"][number]>(client, owner, "products", "id,title,image_url"),
    ownerRows<CustomerDataRecords["runs"][number]>(client, owner, "auto_runs", "id,state,run_date,updated_at"),
    ownerRows<CustomerDataRecords["states"][number]>(client, owner, "auto_account_states", "id,auto_run_id,tiktok_account_id,state,current_step,desired_daily_posts,blockers_json,updated_at"),
    // Include historical baselines. A cumulative counter cannot provide a period total without them.
    ownerRows<CustomerDataRecords["snapshots"][number]>(client, owner, "video_analytics_snapshots", "id,tiktok_account_id,video_id,video_kind,product_id,source,source_snapshot_at,published_at,views,comments,clicks,orders,items_sold,gmv,commission,currency,creative_project_id,script_id,creative_angle_id"),
    ownerRows<NonNullable<CustomerDataRecords["schedules"]>[number]>(client, owner, "post_account_schedules", "tiktok_account_id,posting_mode,creative_mode,clips_per_day,active_start,active_end,timezone,min_spacing_minutes,allowed_days,enabled,daily_budget_usd,next_due_at", undefined, undefined, "tiktok_account_id"),
    ownerRows<NonNullable<CustomerDataRecords["outputs"]>[number]>(client, owner, "post_outputs", "id,tiktok_account_id,video_id,publishing_queue_id,posting_mode,status,caption,hashtags_json,product_reference_json,suggested_post_at,published_at,created_at"),
  ]);
  runs.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const transportReady = serverEnv.tiktokPublishingProvider === "official" && serverEnv.tiktokPublishingRealMode
    && Boolean(serverEnv.tiktokClientKey && serverEnv.tiktokClientSecret);
  const availabilityByAccount = Object.fromEntries(accounts.map((account) => {
    const details = { ...account, audit_status: account.audit_status ?? "UNAUDITED", direct_post_status: account.direct_post_status ?? "UNAVAILABLE", granted_scopes: account.granted_scopes ?? [] };
    const auto = transportReady && serverEnv.tiktokVideoPublishApproved && accountPostingMode(details, "AUTO", false) !== null;
    const draft = transportReady && accountPostingMode(details, "DRAFT", false, serverEnv.tiktokVideoUploadApproved) !== null;
    return [account.id, { AUTO: { available: auto, message: auto ? null : "การโพสต์อัตโนมัติยังไม่พร้อม คลิปจะรอสิทธิ์เผยแพร่และการยืนยัน" },
      DRAFT: { available: draft, message: draft ? null : "บัญชีนี้ยังส่งคลิปไปให้คุณโพสต์ไม่ได้ เลือกดาวน์โหลดไปโพสต์เองได้" },
      EXPORT: { available: true, message: null } }];
  }));
  void now;
  return { accounts, masters, variations, queues, jobs, products, runs, states, snapshots, schedules, outputs, availabilityByAccount };
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
