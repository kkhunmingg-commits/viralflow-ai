"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { assignmentDate } from "@/features/assignments/planner";
import { persistDailyAssignments } from "@/features/assignments/services";
import { runAutoExecutionCycle } from "@/features/auto/execution-service";
import { createAutoRun, transitionAutoRun } from "@/features/auto/services";
import { retryPublishAction } from "@/app/(app)/publishing/actions";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type CustomerPostActionState = { ok: boolean; message: string };
const selectionSchema = z.object({
  accountId: z.uuid(),
  mode: z.enum(["AUTO", "GROWTH", "AFFILIATE"]),
  dailyTarget: z.coerce.number().int().min(1).max(20),
  dailyBudgetUsd: z.coerce.number().finite().min(0).max(1000),
  requestKey: z.uuid(),
});
const scopeSchema = z.object({ accountId: z.uuid(), runId: z.uuid() });
const activeStates = ["STARTING", "RUNNING", "PAUSED", "RETRY_PENDING"];

async function authenticatedOwner() {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("authentication_required");
  await enforceOwnerMutationRateLimit("auto", data.user.id);
  return { client, ownerId: data.user.id };
}

function refreshCustomerPost(accountId: string) {
  revalidatePath("/home");
  revalidatePath("/post");
  revalidatePath(`/post/${accountId}`);
  revalidatePath("/auto");
}

/** The existing durable processor is the only execution path. */
function scheduleExecution(ownerId: string, runId: string) {
  after(async () => {
    try {
      await runAutoExecutionCycle(createAdminClient(), ownerId, runId);
    } catch {
      // The existing recovery path resumes from its persisted checkpoint.
    }
  });
}

export async function startCustomerPostAction(
  _previous: CustomerPostActionState,
  formData: FormData,
): Promise<CustomerPostActionState> {
  const parsed = selectionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "กรุณาตรวจเป้าหมายและงบที่เลือกอีกครั้ง" };
  try {
    const { client, ownerId } = await authenticatedOwner();
    const account = await client.from("tiktok_accounts").select("id")
      .eq("owner_id", ownerId).eq("id", parsed.data.accountId).maybeSingle();
    if (account.error || !account.data) return { ok: false, message: "ไม่พบบัญชีที่เลือก กรุณาเลือกบัญชีของคุณอีกครั้ง" };
    const active = await client.from("auto_runs").select("id")
      .eq("owner_id", ownerId).in("state", activeStates).limit(1).maybeSingle();
    if (active.error) throw new Error("active_read_failed");
    if (active.data) return { ok: false, message: "มีงานกำลังทำอยู่ กรุณารอให้จบหรือหยุดงานนั้นก่อน" };

    // Preserve the same assignment and domain-service boundary used by /auto.
    const assignments = await client.from("product_assignments").select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId).eq("tiktok_account_id", parsed.data.accountId)
      .eq("assignment_date", assignmentDate(new Date().toISOString()))
      .in("status", ["CANDIDATE", "SELECTED", "USED"]);
    if (assignments.error) throw new Error("assignment_check_failed");
    if (!assignments.count) await persistDailyAssignments(client, ownerId);
    const run = await createAutoRun(createAdminClient(), ownerId, parsed.data.requestKey, parsed.data);
    const scope = await client.from("auto_account_states").select("tiktok_account_id")
      .eq("owner_id", ownerId).eq("auto_run_id", run.id);
    if (scope.error || scope.data?.length !== 1 || scope.data[0].tiktok_account_id !== parsed.data.accountId) {
      // The atomic active-run lock may return an already-existing owner run.
      // Do not execute it through a different account's START control.
      return { ok: false, message: "มีงานอีกบัญชีกำลังทำอยู่ กรุณารอให้จบก่อน" };
    }
    scheduleExecution(ownerId, run.id);
    refreshCustomerPost(parsed.data.accountId);
    return { ok: true, message: "เริ่มงานบัญชีนี้แล้ว ดูสถานะได้ที่การ์ดบัญชี" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "affiliate_not_eligible") return { ok: false, message: "บัญชีนี้ยังไม่พร้อมสำหรับโหมดนายหน้า กรุณาเลือก AUTO หรือ GROWTH" };
    if (["daily_target_exceeds_account_limit", "operator_selection_exceeds_account_limits", "invalid_operator_selection"].includes(reason)) {
      return { ok: false, message: "เป้าหมายหรืองบสูงกว่าที่บัญชีนี้ตั้งไว้ กรุณาลดจำนวนแล้วลองใหม่" };
    }
    return { ok: false, message: "ยังเริ่มงานไม่ได้ กรุณาตรวจการเชื่อมบัญชีและลองใหม่" };
  }
}

export async function stopCustomerPostAction(
  _previous: CustomerPostActionState,
  formData: FormData,
): Promise<CustomerPostActionState> {
  const parsed = scopeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "ไม่พบงานของบัญชีนี้" };
  try {
    const { client, ownerId } = await authenticatedOwner();
    const scope = await client.from("auto_account_states").select("tiktok_account_id")
      .eq("owner_id", ownerId).eq("auto_run_id", parsed.data.runId);
    if (scope.error || scope.data?.length !== 1 || scope.data[0].tiktok_account_id !== parsed.data.accountId) {
      return { ok: false, message: "หยุดจากการ์ดนี้ไม่ได้ เพราะงานนี้ไม่ได้เป็นของบัญชีนี้เพียงบัญชีเดียว" };
    }
    await transitionAutoRun(createAdminClient(), ownerId, parsed.data.runId, "STOP");
    refreshCustomerPost(parsed.data.accountId);
    return { ok: true, message: "หยุดงานบัญชีนี้แล้ว ผลงานที่ผ่านมาเก็บไว้ตามเดิม" };
  } catch {
    return { ok: false, message: "ยังหยุดงานไม่ได้ กรุณาตรวจสถานะอีกครั้ง" };
  }
}

export async function retryCustomerPostAction(
  _previous: CustomerPostActionState,
  formData: FormData,
): Promise<CustomerPostActionState> {
  const parsed = z.object({ accountId: z.uuid(), queueId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "ไม่พบคลิปที่เลือก" };
  try {
    const { client, ownerId } = await authenticatedOwner();
    const queue = await client.from("publishing_queue").select("id")
      .eq("owner_id", ownerId).eq("tiktok_account_id", parsed.data.accountId)
      .eq("id", parsed.data.queueId).maybeSingle();
    if (queue.error || !queue.data) return { ok: false, message: "คลิปนี้ไม่ได้อยู่ในบัญชีที่เลือก" };
    // Existing retry logic re-checks consent, authorization, limits and idempotency.
    await retryPublishAction(parsed.data.queueId);
    refreshCustomerPost(parsed.data.accountId);
    return { ok: true, message: "ตรวจและดำเนินการคลิปนี้อีกครั้งแล้ว" };
  } catch {
    return { ok: false, message: "คลิปนี้ยังดำเนินการซ้ำไม่ได้ กรุณาตรวจบัญชีและสิทธิ์เผยแพร่ก่อน" };
  }
}
