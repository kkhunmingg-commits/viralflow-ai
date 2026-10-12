import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/server-env";
import { enqueueProviderVideo, advanceProviderJob, reconcileProviderBilling, providerSettings } from "@/features/video-provider/service";
import { RoutedFalProvider } from "@/features/video-provider/fal";
import { TikTokPublishingService } from "@/features/publishing/services";
import { OfficialTikTokPublishingProvider } from "@/features/publishing/provider";
import { runPrePublishGate } from "@/features/compliance/services";
import { createProjectFromAssignment } from "@/features/creative/services";
import { accountAutomationSchema, type AccountAutomation, type DurableWork, type PlannedWork, type SchedulerAccount, type FrequencyRecommendation } from "./contracts";
import { MultiAccountPublishingScheduler, localDay } from "./scheduler";
import { restrictProviderSettings } from "./provider-policy";
import { runWorkerPool, retryAt, type WorkerPorts, type WorkerStore, type WorkOutcome } from "./worker";
import { analyzeFrequency, type FrequencyEvidence } from "./adaptive";
import { resourceAdmission } from "./resources";

type Row = Record<string, unknown>;
const check = (error: unknown) => { if (error) throw new Error("AUTOMATION_STORAGE_UNAVAILABLE"); };
/** Page through all accounts/work. This bound is transport pagination, not an account limit. */
export async function allRows(load: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>, pageSize = 500) {
  const rows: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await load(from, from + pageSize - 1); check(result.error);
    rows.push(...result.data ?? []); if ((result.data?.length ?? 0) < pageSize) return rows;
  }
}
export async function readAccountConfig(admin: SupabaseClient, owner: string, account: string) {
  const result = await admin.from("account_automation_settings").select("config").eq("owner_id", owner).eq("tiktok_account_id", account).maybeSingle(); check(result.error);
  return accountAutomationSchema.parse(result.data?.config ?? {});
}
export async function saveAccountConfig(admin: SupabaseClient, owner: string, account: string, config: unknown) {
  const parsed = accountAutomationSchema.parse(config);
  const owned = await admin.from("tiktok_accounts").select("id").eq("owner_id", owner).eq("id", account).is("hidden_at", null).maybeSingle();
  check(owned.error); if (!owned.data) throw new Error("ACCOUNT_NOT_FOUND");
  check((await admin.from("account_automation_settings").upsert({ owner_id: owner, tiktok_account_id: account, config: parsed, updated_at: new Date().toISOString() })).error);
  // No history deletion; retain bound/external operations for reconciliation.
  const cancel = admin.from("multi_account_work").update({ state: "CANCELLED", reason: "ACCOUNT_PAUSED", lease_token: null, lease_expires_at: null })
    .eq("owner_id", owner).eq("tiktok_account_id", account).eq("kind", "GENERATE").eq("state", "WAITING").is("provider_job_id", null);
  if (!parsed.enabled || parsed.paused) check((await cancel).error);
  if (parsed.enabled && !parsed.paused) {
    check((await admin.from("multi_account_work").update({ state: "WAITING", reason: null })
      .eq("owner_id", owner).eq("tiktok_account_id", account).eq("state", "CANCELLED").eq("reason", "ACCOUNT_PAUSED")
      .is("provider_job_id", null).gte("local_day", localDay(new Date(), parsed.timezone))).error);
  }
}
export interface AccountView { id: string; name: string; username: string | null; connected: boolean; tokenReady: boolean; config: AccountAutomation | null;
  produced: number; ready: number; published: number; waiting: number; failed: number; publishCap: number | null;
  lastPublish: string | null; nextPublish: string | null; estimatedToday: number; actualToday: number | null; recommendation?:FrequencyRecommendation; }
async function recommendAccount(admin:SupabaseClient,owner:string,account:string,config:AccountAutomation,healthy:boolean){
  const [evidence,ownerConfig]=await Promise.all([admin.rpc("multi_account_frequency_evidence",{p_owner:owner,p_account:account}),providerSettings(admin,owner)]);check(evidence.error);
  const settings=ownerConfig.settings,paidPermitted=(settings.mode==="FAL_ONLY"||settings.paidFallback)&&settings.mode!=="GOOGLE_ONLY"&&config.providerPreference!=="GOOGLE_ONLY";
  return analyzeFrequency(config,{...(evidence.data as FrequencyEvidence),paidPermitted,providerAutomated:paidPermitted&&Boolean(serverEnv.falKey),accountHealthy:healthy});
}
export async function dashboard(admin: SupabaseClient, owner: string) {
  const result = await admin.rpc("multi_account_overview", { p_owner: owner });
  if (result.error && ["42883", "PGRST202"].includes(result.error.code)) return { installed: false, accounts: [] as AccountView[], calendar: [] as Row[], health: null as string | null };
  check(result.error);
  const [inputs,ownerConfig]=await Promise.all([admin.rpc("multi_account_advice_inputs",{p_owner:owner}),providerSettings(admin,owner)]);check(inputs.error);
  const accounts = (result.data as AccountView[]).map(a => {const config=accountAutomationSchema.parse(a.config??{}),settings=ownerConfig.settings;
    const paidPermitted=(settings.mode==="FAL_ONLY"||settings.paidFallback)&&settings.mode!=="GOOGLE_ONLY"&&config.providerPreference!=="GOOGLE_ONLY";
    return {...a,config,recommendation:analyzeFrequency(config,{...inputs.data[a.id] as FrequencyEvidence,paidPermitted,providerAutomated:paidPermitted&&Boolean(serverEnv.falKey),accountHealthy:a.connected&&a.tokenReady})};});
  const days = [...new Set(accounts.flatMap(a => [localDay(new Date(), a.config.timezone), localDay(new Date(Date.now() + 86400000), a.config.timezone)]))];
  const calendar = days.length ? await allRows((from, to) => admin.from("multi_account_work").select("id,tiktok_account_id,local_day,kind,due_at,state,reason")
    .eq("owner_id", owner).in("local_day", days).order("due_at").order("id").range(from, to)) : [];
  const health = await admin.from("multi_account_worker_health").select("last_seen").order("last_seen", { ascending: false }).limit(1).maybeSingle(); check(health.error);
  return { installed: true, accounts, calendar, health: health.data?.last_seen as string | null, workerActive:Date.parse(health.data?.last_seen??"")>Date.now()-120000 };
}
export class DatabaseWorkerStore implements WorkerStore {
  constructor(private readonly admin: SupabaseClient) {}
  async claim(kind: "GENERATE" | "PUBLISH" | "RECONCILE", token: string) {
    const result = await this.admin.rpc("claim_multi_account_work", { p_kind: kind, p_token: token, p_lease_seconds: 600 }); check(result.error);
    return result.data?.id ? result.data as DurableWork : null;
  }
  async finish(work: DurableWork, out: WorkOutcome) {
    const result = await this.admin.rpc("finish_multi_account_work", { p_owner: work.owner_id, p_id: work.id, p_token: work.lease_token,
      p_state: out.state, p_reason: out.reason, p_retry_at: out.retryAt ?? null, p_provider_job: out.providerJobId ?? null,
      p_publish_queue: out.publishingQueueId ?? null, p_project: out.creativeProjectId ?? null }); check(result.error); return result.data === true;
  }
}
const waiting = (reason: string, minutes = 5): WorkOutcome => ({ state: "WAITING", reason, retryAt: new Date(Date.now() + minutes * 60000).toISOString() });

export function createWorkerPorts(admin: SupabaseClient, safe: boolean, canPublish: boolean): WorkerPorts {
  async function active(work: DurableWork) {
    const config = await readAccountConfig(admin, work.owner_id, work.tiktok_account_id);
    const account = await admin.from("tiktok_accounts").select("authorization_status,hidden_at,account_status,is_mock,token_expires_at,refresh_token_expires_at").eq("owner_id", work.owner_id).eq("id", work.tiktok_account_id).single(); check(account.error);
    if (!account.data) throw new Error("ACCOUNT_NOT_FOUND");
    return { config, active: config.enabled && !config.paused && !account.data.hidden_at && account.data.authorization_status === "authorized" && account.data.account_status==="active" && !account.data.is_mock && (Date.parse(account.data.token_expires_at)>Date.now()||Date.parse(account.data.refresh_token_expires_at)>Date.now()) };
  }
  return {
    async generate(work) {
      if (safe) return waiting("SAFE_MODE");
      if (process.env.VIDEO_PROVIDER_ROUTER_ENABLED !== "true") return waiting("PROVIDER");
      const { config, active: permitted } = await active(work); if (!permitted) return waiting("ACCOUNT_PAUSED");
      if (!work.provider_job_id && !work.creative_project_id) {
        const advice=await recommendAccount(admin,work.owner_id,work.tiktok_account_id,config,true);
        if (work.ordinal>advice.generation) return {state:"CANCELLED",reason:"REPLANNED"};
      }
      let projectId = work.creative_project_id;
      if (!projectId) {
        // Reuse real selected Creative Brain output. Never invent a safe script or invoke a paid text provider here.
        const projects = await allRows((from, to) => admin.from("creative_projects").select("id,product_id,selected_script_id")
          .eq("owner_id", work.owner_id).eq("tiktok_account_id", work.tiktok_account_id).not("selected_script_id", "is", null).order("created_at").order("id").range(from, to));
        const used = await allRows((from, to) => admin.from("multi_account_work").select("creative_project_id").eq("owner_id", work.owner_id).eq("kind", "GENERATE").not("creative_project_id", "is", null).order("id").range(from, to));
        const masters = await allRows((from, to) => admin.from("master_videos").select("creative_project_id").eq("owner_id", work.owner_id).eq("tiktok_account_id", work.tiktok_account_id).order("id").range(from, to));
        const usedIds = new Set([...used, ...masters].map(r => r.creative_project_id));
        for (const project of projects) {
          if (usedIds.has(project.id)) continue;
          const product = await admin.from("products").select("category_key").eq("owner_id", work.owner_id).eq("id", project.product_id).single(); check(product.error);
          if (!product.data) continue;
          if (config.categories.length && !config.categories.includes(product.data.category_key)) continue;
          const bound = await admin.from("multi_account_work").update({ creative_project_id: project.id }).eq("owner_id", work.owner_id).eq("id", work.id).eq("lease_token", work.lease_token).gt("lease_expires_at", new Date().toISOString()).select("id").maybeSingle();
          if (bound.error?.code === "23505") continue; check(bound.error); if (bound.data) { projectId = String(project.id); break; }
        }
        if (!projectId) {
          // Product Radar/Assignment output can be prepared using its existing no-spend project boundary.
          const assignments = await admin.from("product_assignments").select("id,product_id").eq("owner_id", work.owner_id).eq("tiktok_account_id", work.tiktok_account_id).eq("assignment_date", work.local_day).in("status", ["CANDIDATE", "SELECTED"]).order("rank_for_account").limit(1); check(assignments.error);
          if (assignments.data?.[0]) await createProjectFromAssignment(admin, work.owner_id, assignments.data[0].id);
          return waiting("CREATIVE_REQUIRED");
        }
      }
      const runtime = { fal: new RoutedFalProvider(serverEnv.falKey ?? ""), enabled: process.env.VIDEO_PROVIDER_ROUTER_ENABLED === "true",
        accountDailyCapUsd: config.dailyBudgetUsd, restrictSettings: (settings: Parameters<typeof restrictProviderSettings>[0]) => restrictProviderSettings(settings, config, Date.parse(work.due_at) <= Date.now()),
        authorizeSubmission: async () => { const fresh = await active(work); const mode = await admin.from("multi_account_runtime").select("enabled,execution_mode").eq("singleton",true).single(); check(mode.error); if (!mode.data?.enabled || mode.data.execution_mode !== "ENABLED" || process.env.VIDEO_PROVIDER_ROUTER_ENABLED !== "true" || !fresh.active || fresh.config.dailyBudgetUsd !== config.dailyBudgetUsd || fresh.config.providerPreference !== config.providerPreference) throw new Error("ACCOUNT_PERMISSION_CHANGED"); } };
      const prior = await admin.from("video_provider_jobs").select("id").eq("owner_id", work.owner_id).eq("tiktok_account_id", work.tiktok_account_id).eq("creative_project_id", projectId).maybeSingle(); check(prior.error);
      const job = work.provider_job_id ? { id: work.provider_job_id } : prior.data ?? await enqueueProviderVideo(admin, work.owner_id, projectId, runtime);
      // Persist identity BEFORE advancing. Any restart recovers the same logical video purchase.
      const bound = await admin.from("multi_account_work").update({ provider_job_id: job.id }).eq("owner_id", work.owner_id).eq("id", work.id).eq("lease_token", work.lease_token).gt("lease_expires_at", new Date().toISOString()).select("id").maybeSingle(); check(bound.error); if (!bound.data) throw new Error("LEASE_LOST");
      await advanceProviderJob(admin, work.owner_id, job.id, runtime);
      const result = await admin.from("video_provider_jobs").select("state,message,master_video_id").eq("owner_id", work.owner_id).eq("id", job.id).single(); check(result.error);
      if (!result.data) throw new Error("JOB_NOT_FOUND");
      const state = result.data.state;
      if (state === "COMPLETED" && result.data.master_video_id) {
        try {
          const queued = await stageReadyVideo(admin, work.owner_id, work.tiktok_account_id, result.data.master_video_id);
          return { state: "COMPLETE", reason: "CONSENT_REQUIRED", providerJobId: job.id, creativeProjectId: projectId, publishingQueueId: queued.id };
        } catch { return { state: "REVIEW_REQUIRED", reason: "REVIEW_REQUIRED", providerJobId: job.id, creativeProjectId: projectId }; }
      }
      return { ...(state === "COMPLETED" ? { state: "COMPLETE" as const, reason: "READY" } : state === "FAILED" ? { state: "FAILED" as const, reason: "FAILED" } : state === "REVIEW_REQUIRED" || state === "RECONCILIATION_REQUIRED" ? { state: "REVIEW_REQUIRED" as const, reason: "REVIEW_REQUIRED" } : waiting(state === "WAITING_ASSISTED" ? "ASSISTED" : "PROVIDER", state === "WAITING_ASSISTED" ? 10 : 1)), providerJobId: job.id, creativeProjectId: projectId };
    },
    async publish(work) {
      if (safe || !canPublish) return waiting("SAFE_MODE");
      if (serverEnv.tiktokPublishingProvider !== "official" || !serverEnv.tiktokPublishingRealMode) return waiting("PROVIDER");
      const eligibility = await active(work); if (!eligibility.active) return waiting("ACCOUNT_PAUSED");
      const q = await admin.from("publishing_queue").select("*").eq("owner_id", work.owner_id).eq("id", work.publishing_queue_id).eq("tiktok_account_id", work.tiktok_account_id).single(); check(q.error);
      if (q.data.status === "PUBLISHED") return { state: "COMPLETE", reason: "READY" };
      if (q.data.provider_publish_id || q.data.external_state === "SUBMITTED_UNKNOWN") return waiting("RECONCILE");
      if (!q.data.consent_id || !["APPROVED", "QUEUED", "RETRYING"].includes(q.data.status)) return waiting("CONSENT_REQUIRED");
      // Background server-hosted media must use an owner-verified pull URL. No FILE_UPLOAD workaround.
      if (q.data.source_method !== "PULL_FROM_URL" || !q.data.pull_from_url) return waiting("TRANSPORT");
      const reserve = await admin.rpc("reserve_multi_account_publish", { p_owner: work.owner_id, p_queue: q.data.id }); check(reserve.error);
      if (reserve.data !== "READY") return waiting(String(reserve.data));
      const result = await new TikTokPublishingService(admin).directPost(work.owner_id, q.data.id);
      return result.status === "PUBLISHED" ? { state: "COMPLETE", reason: "READY" } : result.status === "FAILED" ? { state: "FAILED", reason: "FAILED" } : waiting("RECONCILE", 1);
    },
    async reconcile(work) {
      if (safe) return waiting("SAFE_MODE");
      if (work.provider_job_id) {
        const prior = await admin.from("video_provider_jobs").select("provider_request_id,state,submission_state").eq("owner_id",work.owner_id).eq("id",work.provider_job_id).single(); check(prior.error);
        if (!prior.data?.provider_request_id) return { state:"REVIEW_REQUIRED",reason:"RECOVERY_REQUIRED" };
        // Read/poll the known paid operation even if the account was paused/removed. Never submit a replacement.
        await advanceProviderJob(admin,work.owner_id,work.provider_job_id,{fal:new RoutedFalProvider(serverEnv.falKey??""),enabled:false,authorizeSubmission:async()=>{throw new Error("RECONCILIATION_ONLY");}});
        const after = await admin.from("video_provider_jobs").select("state").eq("owner_id",work.owner_id).eq("id",work.provider_job_id).single(); check(after.error);
        if (after.data?.state === "COMPLETED") return {state:"COMPLETE",reason:"READY"};
        if (after.data?.state === "FAILED") return {state:"FAILED",reason:"FAILED"};
        if (["REVIEW_REQUIRED","RECONCILIATION_REQUIRED"].includes(after.data?.state??"") || work.attempts>=120) return {state:"REVIEW_REQUIRED",reason:"RECOVERY_REQUIRED"};
        return {...waiting("RECONCILE"),retryAt:retryAt(Math.min(6,work.attempts))};
      }
      if (serverEnv.tiktokPublishingProvider !== "official" || !serverEnv.tiktokPublishingRealMode) return waiting("PROVIDER");
      if (!work.publishing_queue_id) return { state: "REVIEW_REQUIRED", reason: "RECOVERY_REQUIRED" };
      const q = await admin.from("publishing_queue").select("provider_publish_id,status").eq("owner_id", work.owner_id).eq("id", work.publishing_queue_id).single(); check(q.error);
      if (!q.data) throw new Error("QUEUE_NOT_FOUND");
      if (q.data.status === "PUBLISHED") return { state: "COMPLETE", reason: "READY" };
      if (["FAILED", "CANCELLED", "REJECTED"].includes(q.data.status)) return { state: "FAILED", reason: "FAILED" };
      if (!q.data.provider_publish_id) return { state: "REVIEW_REQUIRED", reason: "RECOVERY_REQUIRED" };
      const result = await new TikTokPublishingService(admin).fetchPublishStatus(work.owner_id, work.publishing_queue_id);
      return result.status === "PUBLISHED" ? { state: "COMPLETE", reason: "READY" } : result.status === "FAILED" ? { state: "FAILED", reason: "FAILED" } : work.attempts >= 120 ? { state: "REVIEW_REQUIRED", reason: "RECOVERY_REQUIRED" } : { ...waiting("RECONCILE"), retryAt: retryAt(Math.min(6, work.attempts)) };
    },
  };
}

export async function tickMultiAccount(admin: SupabaseClient) {
  const deadlineAt = Date.now() + 180000;
  const runtime = await admin.from("multi_account_runtime").select("enabled,execution_mode,publishing_enabled").eq("singleton", true).single(); check(runtime.error);
  if (!runtime.data) throw new Error("RUNTIME_NOT_FOUND");
  if (!runtime.data.enabled) return { disabled: true, paidCalls: 0, postingCalls: 0 };
  const safe = runtime.data.execution_mode !== "ENABLED";
  const plannerToken = randomUUID(), planner = await admin.rpc("claim_multi_account_planner", { p_token: plannerToken }); check(planner.error);
  const rows = planner.data?.singleton ? await allRows((from, to) => admin.from("account_automation_settings").select("owner_id,tiktok_account_id,config").order("owner_id").order("tiktok_account_id").range(from, to)) : [];
  const cursor = planner.data?.planner_cursor_owner ? `${planner.data.planner_cursor_owner}:${planner.data.planner_cursor_account}` : "";
  const nextIndex = rows.findIndex(row => `${row.owner_id}:${row.tiktok_account_id}` > cursor), rotation = Math.max(0,nextIndex);
  const rotated = [...rows.slice(rotation), ...rows.slice(0,rotation)];
  const scheduler = new MultiAccountPublishingScheduler(); let planned = 0;
  try { for (const row of rotated) {
    if (Date.now() >= Date.parse(planner.data.planner_expires_at) - 15000) break;
    const account = await admin.from("tiktok_accounts").select("authorization_status,hidden_at,token_expires_at,refresh_token_expires_at,account_status,is_mock").eq("owner_id", row.owner_id).eq("id", row.tiktok_account_id).single(); check(account.error);
    if (!account.data) continue;
    const config = accountAutomationSchema.parse(row.config);
    const healthy=account.data.authorization_status==="authorized"&&!account.data.is_mock&&account.data.account_status==="active"&&(Date.parse(account.data.token_expires_at)>Date.now()||Date.parse(account.data.refresh_token_expires_at)>Date.now());
    const recommendation=await recommendAccount(admin,String(row.owner_id),String(row.tiktok_account_id),config,healthy);
    const seed=await admin.rpc("multi_account_day_seed",{p_owner:row.owner_id,p_account:row.tiktok_account_id,p_day:localDay(new Date(),config.timezone)});check(seed.error);
    const item: SchedulerAccount = { ownerId: String(row.owner_id), id: String(row.tiktok_account_id), config, connected: healthy, hidden: Boolean(account.data.hidden_at), ready: 0, produced: 0, published: 0, publishCap: null,recommendation,scheduleSeed:String(seed.data) };
    const today = new Date(), tomorrow = new Date(today.getTime() + 86400000);
    const nextSeed=await admin.rpc("multi_account_day_seed",{p_owner:row.owner_id,p_account:row.tiktok_account_id,p_day:localDay(tomorrow,config.timezone)});check(nextSeed.error);
    const plans: (PlannedWork & { queueId?: string; providerJobId?:string })[] = [...scheduler.plan([item], today), ...scheduler.plan([{...item,scheduleSeed:String(nextSeed.data)}], tomorrow)];
    const pendingProviders=await allRows((from,to)=>admin.from("video_provider_jobs").select("id,created_at").eq("owner_id",row.owner_id).eq("tiktok_account_id",row.tiktok_account_id).in("state",["PROCESSING","RECONCILIATION_REQUIRED"]).in("submission_state",["SUBMITTING","ACCEPTED"]).order("created_at").order("id").range(from,to));
    for (const job of pendingProviders) plans.push({ownerId:item.ownerId,accountId:item.id,day:localDay(new Date(String(job.created_at)),config.timezone),ordinal:1,kind:"RECONCILE",dueAt:String(job.created_at),availableAt:new Date().toISOString(),priority:config.priority,providerJobId:String(job.id)});
    const queues = await allRows((from, to) => admin.from("publishing_queue").select("id,status,provider_publish_id,external_state,scheduled_for,created_at,consent_id")
      .eq("owner_id", row.owner_id).eq("tiktok_account_id", row.tiktok_account_id).eq("publish_mode", "DIRECT_POST").in("status", ["APPROVED", "QUEUED", "RETRYING", "UPLOADING", "PROCESSING", "WAITING_FOR_RECONCILIATION"]).order("created_at").order("id").range(from, to));
    const slots = scheduler.plan([{ ...item, recommendation:{...recommendation,generation:recommendation.publishing} }], today);
    let ordinal = 0;
    for (const q of queues) {
      const reconciling = Boolean(q.provider_publish_id || q.external_state === "SUBMITTED_UNKNOWN");
      if (!reconciling && (!q.consent_id || ordinal >= slots.length)) continue;
      const slot = reconciling ? { ownerId: item.ownerId, accountId: item.id, day: localDay(new Date(String(q.created_at)), config.timezone), ordinal: 1, kind: "RECONCILE" as const, dueAt: String(q.created_at), availableAt: new Date().toISOString(), priority: config.priority } : slots[ordinal++];
      // Reconciliation ordinal uses stable ordering; queue identity index is the authoritative duplicate guard.
      plans.push({ ...slot, ordinal: reconciling ? queues.findIndex(v => v.id === q.id) + 1 : slot.ordinal, kind: reconciling ? "RECONCILE" : "PUBLISH", queueId: String(q.id), dueAt: reconciling ? slot.dueAt : q.scheduled_for ? String(q.scheduled_for) : slot.dueAt, availableAt: reconciling ? slot.availableAt : q.scheduled_for ? String(q.scheduled_for) : slot.dueAt });
    }
    if (plans.length) { const saved = await admin.rpc("plan_multi_account_work", { p_rows: plans }); check(saved.error); planned += Number(saved.data); }
    // Read-only billing reconciliation; never turns a missing receipt into $0.
    if (!safe && Date.now() < deadlineAt) {
      const billing = await admin.from("video_provider_jobs").select("id").eq("owner_id", row.owner_id).eq("tiktok_account_id", row.tiktok_account_id).eq("provider", "fal_ai").in("state", ["COMPLETED", "FAILED", "REVIEW_REQUIRED"]).is("actual_cost_usd", null).order("updated_at").limit(1); check(billing.error);
      for (const job of billing.data ?? []) await reconcileProviderBilling(admin, String(row.owner_id), job.id).catch(() => undefined);
    }
    check((await admin.from("multi_account_runtime").update({ planner_cursor_owner: row.owner_id, planner_cursor_account: row.tiktok_account_id }).eq("singleton",true).eq("planner_token",plannerToken).gt("planner_expires_at",new Date().toISOString())).error);
  } } finally { if (planner.data?.singleton) check((await admin.from("multi_account_runtime").update({ planner_token:null,planner_expires_at:null }).eq("singleton",true).eq("planner_token",plannerToken)).error); }
  const store = new DatabaseWorkerStore(admin), ports = createWorkerPorts(admin, safe, runtime.data.publishing_enabled);
  const before=await admin.rpc("multi_account_monitor");check(before.error);
  const observedInFlight=Number(before.data.providerInFlight),resource=resourceAdmission(Number(before.data.waiting),observedInFlight>0?observedInFlight+1:null);
  // Ramp cautiously from actual accepted operations; CPU/RAM/budgets remain independent admission gates.
  const options={batch:Math.max(1,resource.concurrency*2),concurrency:resource.concurrency};
  const results = [];
  if(options.concurrency>0)for (const kind of ["RECONCILE", "GENERATE", "PUBLISH"] as const) results.push(await runWorkerPool(store, ports, { ...options, kind, token: randomUUID, deadlineAt }));
  const monitor = await admin.rpc("multi_account_monitor"); check(monitor.error);
  check((await admin.from("multi_account_worker_health").upsert({ worker_id: randomUUID(), last_seen: new Date().toISOString(), result: { safe, planned, results,monitor:monitor.data,resources:resource } })).error);
  check((await admin.from("multi_account_worker_health").delete().lt("last_seen", new Date(Date.now() - 86400000).toISOString())).error);
  return { disabled: false, safe, planned, results };
}

/** An explicit review operation reuses the existing compliance/publishing queue. It never records consent. */
export async function stageReadyVideo(admin: SupabaseClient, owner: string, account: string, video: string) {
  const gate = await runPrePublishGate(admin, owner, "master", video, false);
  if (!["READY_FOR_REVIEW", "READY_TO_PUBLISH"].includes(gate.eligibility.finalStatus)) throw new Error("REVIEW_REQUIRED");
  // queueVideo performs only storage operations; the official adapter here makes no external request.
  return new TikTokPublishingService(admin, new OfficialTikTokPublishingProvider(fetch, serverEnv.tiktokAllowedUploadHosts)).queueVideo({ ownerId: owner, accountId: account, videoId: video, videoKind: "MASTER", publishMode: "DIRECT_POST", idempotencyKey: `multi-account:${account}:${video}` });
}
