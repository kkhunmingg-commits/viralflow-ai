import type { SupabaseClient } from "@supabase/supabase-js";
import { assertMp4, createPostPackageZip, postCaption } from "../manual-post/package";
import { VIDEO_BUCKET } from "../video/types";
import { BANK_POLICY_VERSION, bankAcceptance, bankCostSummary, bankHashtags, creativeFingerprint, machineCostEstimate, planBankSlot } from "./policy";

type Row = Record<string, unknown>;
const must = <T>(result: { data: T | null; error: { message: string } | null }, code: string): T => {
  if (result.error || result.data === null) throw new Error(`${code}${result.error ? `: ${result.error.message}` : ""}`);
  return result.data;
};

/** Posting goes through the API only once TikTok has audited the app and the operator enabled it;
 * until then every banked clip is prepared for the owner to post by hand. */
export function postingRoute(runtime: Row | null): "MANUAL_EXPORT" | "AUTO_API" {
  return runtime?.enabled === true && runtime.execution_mode === "ENABLED" && runtime.publishing_enabled === true && runtime.app_audit_status === "AUDITED"
    ? "AUTO_API" : "MANUAL_EXPORT";
}

/** Checks a finished master against the bank's rules and records the outcome either way, so a
 * rejected render still counts toward cost per usable clip. Nothing here posts. */
export async function acceptMasterIntoBank(client: SupabaseClient, owner: string, masterId: string,
  options: { now?: Date; peakRssMb?: number | null; machineThbPerHour?: number | null } = {}) {
  const now = options.now ?? new Date();
  const master = must(await client.from("master_videos").select("*").eq("owner_id", owner).eq("id", masterId).maybeSingle(), "BANK_MASTER_NOT_FOUND") as Row;
  const existing = await client.from("content_bank_items").select("*").eq("owner_id", owner).eq("master_video_id", masterId).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data as Row;
  const accountId = String(master.tiktok_account_id);
  const [script, project, settings, asset, costs, runtime, banked] = await Promise.all([
    client.from("scripts").select("hook_text,voice_script,cta_text,caption,hashtags_json,overlay_text_json").eq("owner_id", owner).eq("id", String(master.selected_script_id)).maybeSingle(),
    client.from("creative_projects").select("selected_angle_id").eq("owner_id", owner).eq("id", String(master.creative_project_id)).maybeSingle(),
    client.from("account_automation_settings").select("config").eq("owner_id", owner).eq("tiktok_account_id", accountId).maybeSingle(),
    client.from("media_assets").select("checksum").eq("owner_id", owner).eq("storage_path", String(master.storage_path)).maybeSingle(),
    master.generation_job_id ? client.from("generation_costs").select("total_cost_usd").eq("owner_id", owner).eq("generation_job_id", String(master.generation_job_id)) : { data: [], error: null },
    client.from("multi_account_runtime").select("enabled,execution_mode,publishing_enabled,app_audit_status").maybeSingle(),
    client.from("content_bank_items").select("id,status,video_sha256,creative_fingerprint,planned_slot_at").eq("owner_id", owner).eq("tiktok_account_id", accountId),
  ]);
  const s = must(script, "BANK_SCRIPT_NOT_FOUND") as Row, checksum = String((must(asset, "BANK_VIDEO_ASSET_NOT_FOUND") as Row).checksum ?? "");
  if (costs.error || banked.error) throw new Error("BANK_SOURCE_UNAVAILABLE");
  const angle = project.data?.selected_angle_id ? await client.from("creative_angles").select("score_explanation_json").eq("owner_id", owner).eq("id", String(project.data.selected_angle_id)).maybeSingle() : null;
  const strategy = ((angle?.data as Row | null)?.score_explanation_json as Row | null)?.productionStrategy as
    { plan?: { topic?: string | null; concepts?: Array<{ id: string; production?: { story?: { format?: string } } }> }; conceptId?: string } | undefined;
  const story = strategy?.plan?.concepts?.find(c => c.id === strategy.conceptId)?.production?.story;
  const overlay = Array.isArray(s.overlay_text_json) ? (s.overlay_text_json as Array<{ start: number; text: string }>).toSorted((a, b) => a.start - b.start).map(o => o.text) : [];
  const fingerprint = creativeFingerprint(overlay.length ? overlay : [String(s.hook_text ?? ""), String(s.voice_script ?? "")]);
  const live = (banked.data ?? []).filter(b => b.status !== "REJECTED");
  const duplicate = live.find(b => b.video_sha256 === checksum || b.creative_fingerprint === fingerprint);
  const explanation = (master.quality_explanation_json ?? {}) as Row;
  const rights = await client.rpc("media_rights_violations", { p_owner: owner, p_video_kind: "MASTER", p_video_id: masterId, p_account: accountId });
  if (rights.error) throw new Error("BANK_RIGHTS_CHECK_UNAVAILABLE");
  const decision = bankAcceptance({ masterStatus: String(master.status), qualityStatus: String(master.quality_status),
    checks: Array.isArray(explanation.checks) ? explanation.checks as AcceptanceChecks : [], rightsViolations: (rights.data ?? []) as string[],
    duplicateOf: duplicate ? String(duplicate.id) : null, narrationKind: (explanation.narration as Row | undefined)?.kind as string ?? null });
  if (!/^[0-9a-f]{64}$/.test(checksum)) decision.reasons.push("VIDEO_CHECKSUM_MISSING");
  const config = (settings.data?.config ?? {}) as Row;
  const copy = postCaption(String(s.caption ?? s.hook_text ?? ""), bankHashtags(Array.isArray(s.hashtags_json) ? s.hashtags_json as string[] : [], Array.isArray(config.categories) ? config.categories as string[] : []));
  const renderSeconds = typeof explanation.renderSeconds === "number" ? explanation.renderSeconds : null;
  const estimate = machineCostEstimate(renderSeconds, options.machineThbPerHour ?? null);
  const accepted = decision.accepted && decision.reasons.length === 0;
  const slot = accepted ? planBankSlot({ now, timeZone: typeof config.timezone === "string" ? config.timezone : "Asia/Bangkok",
    audienceMinutes: Array.isArray(config.audienceMinutes) ? config.audienceMinutes as number[] : [],
    taken: live.filter(b => b.planned_slot_at).map(b => new Date(String(b.planned_slot_at))),
    minGapMinutes: Math.max(180, Number(config.minimumGapMinutes ?? 0)), dailyTarget: 2 }) : { at: null, basis: null };
  const row = { owner_id: owner, tiktok_account_id: accountId, master_video_id: masterId, status: accepted ? "ACCEPTED" : "REJECTED",
    rejection_reasons: decision.reasons, acceptance_checks: [...(Array.isArray(explanation.checks) ? explanation.checks : []), { name: "BANK_POLICY", passed: accepted, detail: BANK_POLICY_VERSION }],
    video_sha256: /^[0-9a-f]{64}$/.test(checksum) ? checksum : "0".repeat(64), creative_fingerprint: fingerprint, caption: copy.caption || String(s.hook_text),
    hashtags: copy.hashtags, story_format: story?.format ?? null, topic: strategy?.plan?.topic ?? null,
    cost_actual_usd: (costs.data ?? []).reduce((a, c) => a + Number(c.total_cost_usd ?? 0), 0), cost_estimated_thb: estimate.thb, cost_basis: estimate.basis,
    render_seconds: renderSeconds, peak_rss_mb: options.peakRssMb ?? null, planned_slot_at: slot.at?.toISOString() ?? null, slot_basis: slot.basis,
    posting_route: postingRoute(runtime.data as Row | null) };
  return must(await client.from("content_bank_items").insert(row).select("*").single(), "BANK_INSERT_FAILED") as Row;
}
type AcceptanceChecks = Array<{ name: string; passed: boolean; detail?: string }>;

/** The manual-post ZIP (video, caption, manifest) for the owner to post while TikTok's app review
 * is pending. The manifest carries the planned slot and the review checklist; it does not post. */
export async function bankPackage(client: SupabaseClient, owner: string, itemId: string) {
  const item = must(await client.from("content_bank_items").select("*").eq("owner_id", owner).eq("id", itemId).maybeSingle(), "BANK_ITEM_NOT_FOUND") as Row;
  if (item.status === "REJECTED" || item.status === "WITHDRAWN") throw new Error("BANK_ITEM_NOT_POSTABLE");
  const master = must(await client.from("master_videos").select("storage_path,quality_explanation_json").eq("owner_id", owner).eq("id", String(item.master_video_id)).maybeSingle(), "BANK_MASTER_NOT_FOUND") as Row;
  const file = await client.storage.from(VIDEO_BUCKET).download(String(master.storage_path));
  if (file.error || !file.data) throw new Error("BANK_VIDEO_DOWNLOAD_FAILED");
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  assertMp4(bytes, "video/mp4");
  const copy = postCaption(String(item.caption), item.hashtags as string[]);
  const aiVoice = Boolean((master.quality_explanation_json as Row | null)?.aiGeneratedVoice);
  const manifest = { version: BANK_POLICY_VERSION, itemId, accountId: item.tiktok_account_id, plannedSlotAt: item.planned_slot_at, slotBasis: item.slot_basis,
    postingRoute: item.posting_route, storyFormat: item.story_format, videoSha256: item.video_sha256, aiGeneratedVoice: aiVoice,
    ownerChecklist: ["ดูคลิปจนจบและยืนยันว่าคำพูดตรงกับภาพ", "ตรวจแคปชันและแฮชแท็ก", ...(aiVoice ? ["เปิดป้าย AI-generated content ใน TikTok เพราะเสียงพากย์สังเคราะห์"] : []), "โพสต์ด้วยบัญชีที่ตรงกับ accountId เท่านั้น"] };
  return createPostPackageZip([{ name: "video.mp4", bytes }, { name: "caption.txt", bytes: new TextEncoder().encode(copy.text) },
    { name: "package.json", bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) }]);
}

export async function bankSummary(client: SupabaseClient, owner: string, accountId: string, thbPerUsd: number | null) {
  const items = await client.from("content_bank_items").select("status,cost_actual_usd,cost_estimated_thb").eq("owner_id", owner).eq("tiktok_account_id", accountId);
  if (items.error) throw new Error(items.error.message);
  return bankCostSummary((items.data ?? []) as Array<{ status: string; cost_actual_usd: number; cost_estimated_thb: number | null }>, thbPerUsd);
}
