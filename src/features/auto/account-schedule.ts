import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_AUTO_ACCOUNT_STATES, createAutoRun } from "./services";
import type { AutoRun } from "./types";
import { logOps } from "../../lib/ops/logger";

export type AccountPostingMode = "AUTO" | "DRAFT" | "EXPORT";
export interface AccountPostScheduleInput {
  postingMode: AccountPostingMode; creativeMode: "AUTO" | "GROWTH" | "AFFILIATE";
  clipsPerDay: number; activeStart: string; activeEnd: string; timezone: string;
  minSpacingMinutes: number; allowedDays: number[]; enabled: boolean; dailyBudgetUsd: number;
}
export interface AccountPostSchedule {
  owner_id: string; tiktok_account_id: string; posting_mode: AccountPostingMode;
  creative_mode: "AUTO" | "GROWTH" | "AFFILIATE"; clips_per_day: number;
  active_start: number; active_end: number; timezone: string; min_spacing_minutes: number;
  allowed_days: number[]; enabled: boolean; daily_budget_usd: number; next_due_at: string | null;
  revision: number; created_at: string; updated_at: string;
}
export interface AccountScheduleSlot {
  localDate: string; ordinal: number; key: string; scheduledAt: string; expiresAt: string;
}
interface StoredScheduleSlot {
  owner_id: string; tiktok_account_id: string; local_date: string; ordinal: number; slot_key: string;
  scheduled_at: string; expires_at: string; posting_mode: AccountPostingMode; lease_token: string;
}

function minutes(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value) && value !== "24:00") throw new Error("invalid_post_schedule");
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
export function validateAccountPostSchedule(input: AccountPostScheduleInput): AccountPostScheduleInput {
  if (!["AUTO", "DRAFT", "EXPORT"].includes(input.postingMode) || !["AUTO", "GROWTH", "AFFILIATE"].includes(input.creativeMode)
    || !Number.isInteger(input.clipsPerDay) || input.clipsPerDay < 1 || input.clipsPerDay > 20
    || !Number.isInteger(input.minSpacingMinutes) || input.minSpacingMinutes < 1 || input.minSpacingMinutes > 1440
    || !Array.isArray(input.allowedDays) || input.allowedDays.length < 1 || input.allowedDays.length > 7
    || input.allowedDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    || typeof input.enabled !== "boolean" || !Number.isFinite(input.dailyBudgetUsd) || input.dailyBudgetUsd < 0 || input.dailyBudgetUsd > 1000
    || typeof input.timezone !== "string" || input.timezone.length > 80) throw new Error("invalid_post_schedule");
  const start = minutes(input.activeStart), end = minutes(input.activeEnd);
  if (start >= end || start >= 1440) throw new Error("invalid_post_schedule");
  if ((input.clipsPerDay - 1) * input.minSpacingMinutes >= end - start) throw new Error("post_schedule_spacing");
  let timezone: string;
  try { timezone = new Intl.DateTimeFormat("en", { timeZone: input.timezone }).resolvedOptions().timeZone; } catch { throw new Error("invalid_timezone"); }
  return { ...input, timezone, allowedDays: [...new Set(input.allowedDays)].sort((a, b) => a - b) };
}

function localParts(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (key: string) => parts.find((part) => part.type === key)!.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}
export function accountLocalDate(now: Date, timezone: string) { return localParts(now, timezone).date; }

/** Scan UTC minutes to handle both missing and repeated DST wall times honestly. */
export function accountDaySlots(schedule: Pick<AccountPostSchedule, "tiktok_account_id" | "clips_per_day" | "active_start" | "active_end" | "timezone" | "min_spacing_minutes" | "allowed_days">, date: string): AccountScheduleSlot[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("invalid_schedule_date");
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (!schedule.allowed_days.includes(weekday)) return [];
  const spacing = schedule.clips_per_day === 1 ? 0 : Math.max(schedule.min_spacing_minutes, Math.floor((schedule.active_end - schedule.active_start) / schedule.clips_per_day));
  const desired = Array.from({ length: schedule.clips_per_day }, (_, index) => schedule.active_start + index * spacing);
  if (desired.some((time, index) => index > 0 && time - desired[index - 1] < schedule.min_spacing_minutes)) throw new Error("post_schedule_spacing");
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: schedule.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const base = Date.parse(`${date}T00:00:00Z`), candidates = new Map<number, number[]>();
  let dayEnd = base;
  for (let ms = base - 14 * 3600_000; ms <= base + 38 * 3600_000; ms += 60_000) {
    const parts = Object.fromEntries(formatter.formatToParts(ms).map((part) => [part.type, part.value]));
    if (`${parts.year}-${parts.month}-${parts.day}` !== date) continue;
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    if (minute < schedule.active_end) dayEnd = ms + 60_000;
    if (minute >= schedule.active_start && minute < schedule.active_end) candidates.set(minute, [...(candidates.get(minute) ?? []), ms]);
  }
  const times: number[] = [];
  for (const target of desired) {
    const earliest = times.length ? times.at(-1)! + schedule.min_spacing_minutes * 60_000 : -Infinity;
    const match = [...candidates].filter(([minute]) => minute >= target).flatMap(([, values]) => values).sort((a, b) => a - b).find((ms) => ms >= earliest);
    if (match === undefined) break; // A shortened DST day must not invent extra slots.
    times.push(match);
  }
  return times.map((ms, index) => ({ localDate: date, ordinal: index + 1,
    key: `post:${schedule.tiktok_account_id}:${date}:${index + 1}`,
    scheduledAt: new Date(ms).toISOString(), expiresAt: new Date(dayEnd).toISOString() }));
}

export function planAccountSchedule(schedule: AccountPostSchedule, now: Date) {
  const date = accountLocalDate(now, schedule.timezone);
  const slots = accountDaySlots(schedule, date);
  let nextDue = slots.find((slot) => Date.parse(slot.scheduledAt) > now.getTime())?.scheduledAt;
  for (let offset = 1; !nextDue && offset <= 8; offset++) {
    const nextDate = new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86400_000).toISOString().slice(0, 10);
    nextDue = accountDaySlots(schedule, nextDate)[0]?.scheduledAt;
  }
  if (!nextDue) throw new Error("invalid_post_schedule");
  return { slots, nextDue };
}

export async function getAccountPostSchedule(client: SupabaseClient, owner: string, accountId: string) {
  const { data, error } = await client.from("post_account_schedules").select("*").eq("owner_id", owner).eq("tiktok_account_id", accountId).maybeSingle();
  if (error) throw new Error("post_schedule_read_failed");
  return data as AccountPostSchedule | null;
}
export async function saveAccountPostSchedule(admin: SupabaseClient, owner: string, accountId: string, input: AccountPostScheduleInput) {
  const config = validateAccountPostSchedule(input);
  const { data, error } = await admin.rpc("upsert_post_account_schedule", { p_owner_id: owner, p_account_id: accountId,
    p_config: { ...config, activeStart: minutes(config.activeStart), activeEnd: minutes(config.activeEnd) } });
  if (error || !data) throw new Error(error?.message ?? "post_schedule_save_failed");
  return data as AccountPostSchedule;
}
async function controlAccount(admin: SupabaseClient, owner: string, accountId: string, action: "START" | "STOP" | "RETRY") {
  const { data, error } = await admin.rpc("control_post_account", { p_owner_id: owner, p_account_id: accountId, p_action: action });
  if (error || !data) throw new Error(error?.message ?? "post_account_control_failed");
  return data as { runId: string | null; state: string; enabled: boolean };
}
export async function stopAccountPost(admin: SupabaseClient, owner: string, accountId: string) { return controlAccount(admin, owner, accountId, "STOP"); }
export async function retryAccountPost(admin: SupabaseClient, owner: string, accountId: string) { return controlAccount(admin, owner, accountId, "RETRY"); }

async function tickAccount(admin: SupabaseClient, schedule: AccountPostSchedule, now: Date) {
  if (!schedule.enabled) return null;
  const plan = planAccountSchedule(schedule, now);
  const materialized = await admin.rpc("materialize_post_schedule_slots", { p_owner_id: schedule.owner_id, p_account_id: schedule.tiktok_account_id,
    p_revision: schedule.revision, p_slots: plan.slots, p_next_due: plan.nextDue });
  if (materialized.error) throw new Error("post_schedule_materialize_failed");
  const claimed = await admin.rpc("claim_post_schedule_slot", { p_owner_id: schedule.owner_id, p_account_id: schedule.tiktok_account_id, p_now: now.toISOString() });
  if (claimed.error) throw new Error("post_schedule_claim_failed");
  if (!claimed.data) return null;
  const slot = claimed.data as StoredScheduleSlot;
  if (slot.owner_id !== schedule.owner_id || slot.tiktok_account_id !== schedule.tiktok_account_id) throw new Error("post_schedule_scope_mismatch");
  let run: AutoRun | null = null;
  try {
    run = await createAutoRun(admin, schedule.owner_id, slot.slot_key, { accountId: schedule.tiktok_account_id,
      mode: schedule.creative_mode, dailyTarget: 1, dailyBudgetUsd: Number(schedule.daily_budget_usd),
      postingMode: slot.posting_mode, scheduleSlotKey: slot.slot_key, runDate: slot.local_date });
    // A simultaneous manual START may reserve the same account. Leave this slot retryable.
    if ((run as AutoRun & { schedule_slot_key?: string }).schedule_slot_key !== slot.slot_key) run = null;
  } catch {
    const failed = await admin.rpc("settle_post_schedule_slot", { p_owner_id: schedule.owner_id, p_account_id: schedule.tiktok_account_id,
      p_slot_key: slot.slot_key, p_lease_token: slot.lease_token, p_run_id: null, p_failed: true });
    if (failed.error) throw new Error("post_schedule_settle_failed");
    return null;
  }
  const settled = await admin.rpc("settle_post_schedule_slot", { p_owner_id: schedule.owner_id, p_account_id: schedule.tiktok_account_id,
    p_slot_key: slot.slot_key, p_lease_token: slot.lease_token, p_run_id: run?.id ?? null, p_failed: false });
  if (settled.error) throw new Error("post_schedule_settle_failed");
  return run;
}

export async function startAccountPost(admin: SupabaseClient, owner: string, accountId: string, requestKey: string) {
  if (!requestKey || requestKey.length > 160) throw new Error("invalid_post_request");
  const controlled = await controlAccount(admin, owner, accountId, "START");
  const schedule = await getAccountPostSchedule(admin, owner, accountId);
  if (!schedule) throw new Error("post_schedule_required");
  if (controlled.runId) {
    const { data, error } = await admin.from("auto_runs").select("*").eq("owner_id", owner).eq("id", controlled.runId).maybeSingle();
    if (error) throw new Error("post_run_read_failed");
    return { schedule, run: data as AutoRun | null };
  }
  return { schedule, run: await tickAccount(admin, schedule, new Date()) };
}

/** Called by the existing execution endpoint. No in-memory timer owns the schedule. */
export async function tickAccountPostSchedules(admin: SupabaseClient, limit = 20, now = new Date()) {
  const bounded = Math.min(50, Math.max(1, Math.floor(limit)));
  const recovered = await admin.rpc("reconcile_post_schedule_slots");
  if (recovered.error) throw new Error("post_schedule_recovery_failed");
  // Pending/expired claims are scanned even when the materialization cursor is in tomorrow.
  const [due, pending] = await Promise.all([
    admin.from("post_account_schedules").select("*").eq("enabled", true).lte("next_due_at", now.toISOString()).order("next_due_at").limit(bounded),
    admin.from("post_schedule_slots").select("owner_id,tiktok_account_id").in("state", ["PENDING", "CLAIMED"])
      .lte("scheduled_at", now.toISOString()).gt("expires_at", now.toISOString()).order("scheduled_at").limit(bounded * 3),
  ]);
  if (due.error || pending.error) throw new Error("post_schedule_scan_failed");
  const rows = new Map<string, AccountPostSchedule>();
  for (const row of (due.data ?? []) as AccountPostSchedule[]) rows.set(`${row.owner_id}:${row.tiktok_account_id}`, row);
  for (const row of pending.data ?? []) {
    const key = `${row.owner_id}:${row.tiktok_account_id}`;
    if (!rows.has(key) && rows.size < bounded) {
      const schedule = await getAccountPostSchedule(admin, row.owner_id, row.tiktok_account_id);
      if (schedule?.enabled) rows.set(key, schedule);
    }
  }
  const runs: AutoRun[] = [];
  let failedAccounts = 0;
  for (const schedule of rows.values()) {
    try {
      const run = await tickAccount(admin, schedule, now);
      if (run) runs.push(run);
    } catch {
      failedAccounts++;
      logOps({ severity: "ERROR", component: "auto", operation: "account_schedule_tick_failed", owner_id: schedule.owner_id,
        account_id: schedule.tiktok_account_id, error_code: "POST_ACCOUNT_SCHEDULE_FAILED" });
    }
  }
  return { scanned: rows.size, recovered: Number(recovered.data ?? 0), failedAccounts, runs };
}

export function activeAccountState(state: string) { return ACTIVE_AUTO_ACCOUNT_STATES.includes(state); }
