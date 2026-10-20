import type { SupabaseClient } from "@supabase/supabase-js";
import { assertMp4, createPostPackageZip, postCaption } from "../manual-post/package";
import { VIDEO_BUCKET } from "../video/types";
import { BANK_POLICY_VERSION, bankAcceptance, bankCostSummary, bankHashtags, creativeFingerprint, isTestProduct, isTestRights, machineCostEstimate, planBankSlot, publishDecision } from "./policy";

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
  const [script, project, settings, asset, costs, runtime, banked, account, product, usages] = await Promise.all([
    client.from("scripts").select("hook_text,voice_script,cta_text,caption,hashtags_json,overlay_text_json").eq("owner_id", owner).eq("id", String(master.selected_script_id)).maybeSingle(),
    client.from("creative_projects").select("selected_angle_id").eq("owner_id", owner).eq("id", String(master.creative_project_id)).maybeSingle(),
    client.from("account_automation_settings").select("config").eq("owner_id", owner).eq("tiktok_account_id", accountId).maybeSingle(),
    client.from("media_assets").select("checksum").eq("owner_id", owner).eq("storage_path", String(master.storage_path)).maybeSingle(),
    master.generation_job_id ? client.from("generation_costs").select("total_cost_usd").eq("owner_id", owner).eq("generation_job_id", String(master.generation_job_id)) : { data: [], error: null },
    client.from("multi_account_runtime").select("enabled,execution_mode,publishing_enabled,app_audit_status").maybeSingle(),
    client.from("content_bank_items").select("id,status,video_sha256,creative_fingerprint,planned_slot_at").eq("owner_id", owner).eq("tiktok_account_id", accountId),
    client.from("tiktok_accounts").select("mode,effective_mode,is_mock").eq("owner_id", owner).eq("id", accountId).maybeSingle(),
    client.from("products").select("external_provider,provider_metadata").eq("owner_id", owner).eq("id", String(master.product_id)).maybeSingle(),
    client.from("media_asset_usages").select("media_asset_id,rights_id,rights_snapshot").eq("owner_id", owner).eq("master_video_id", masterId),
  ]);
  const s = must(script, "BANK_SCRIPT_NOT_FOUND") as Row, checksum = String((must(asset, "BANK_VIDEO_ASSET_NOT_FOUND") as Row).checksum ?? "");
  if (costs.error || banked.error || account.error || product.error || usages.error || !account.data) throw new Error("BANK_SOURCE_UNAVAILABLE");
  const angle = project.data?.selected_angle_id ? await client.from("creative_angles").select("score_explanation_json").eq("owner_id", owner).eq("id", String(project.data.selected_angle_id)).maybeSingle() : null;
  const strategy = ((angle?.data as Row | null)?.score_explanation_json as Row | null)?.productionStrategy as
    { plan?: { topic?: string | null; concepts?: Array<{ id: string; production?: { story?: { format?: string; beats?: Array<{ role?: string; text?: string }> } } }> }; conceptId?: string } | undefined;
  const story = strategy?.plan?.concepts?.find(c => c.id === strategy.conceptId)?.production?.story;
  const overlay = Array.isArray(s.overlay_text_json) ? (s.overlay_text_json as Array<{ start: number; text: string }>).toSorted((a, b) => a.start - b.start).map(o => o.text) : [];
  // A planned story is the same clip when it teaches the same points in the same format, whatever its hook
  // or closing line; otherwise the on-screen lines decide.
  const points = (story?.beats ?? []).filter(b => b.role === "POINT").map(b => String(b.text ?? ""));
  const fingerprint = creativeFingerprint(story?.format && points.length ? [`format:${story.format}`, ...points]
    : overlay.length ? overlay : [String(s.hook_text ?? ""), String(s.voice_script ?? "")]);
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
  const contentType = (account.data.effective_mode ?? account.data.mode) === "AFFILIATE" ? "AFFILIATE" as const : "GROWTH" as const;
  // The rights each source asset had when this master was built, as the owner will see them in the package.
  const mediaRights = (usages.data ?? []).map(u => { const r = (u.rights_snapshot ?? {}) as Row; return { mediaAssetId: String(u.media_asset_id), rightsId: String(u.rights_id),
    origin: r.origin_source ?? null, role: r.asset_role ?? null, rightsholder: r.rightsholder ?? null, license: r.license_type ?? null, reference: String(r.source_reference ?? ""),
    allowsCommercial: r.allows_commercial === true, allowsPromotion: r.allows_promotion === true, expiresAt: r.expires_at ?? null, testOnly: isTestRights(String(r.source_reference ?? "")) } });
  const graphicOnly = master.render_strategy === "LOCAL_TEMPLATE" || explanation.originalGraphics === true;
  const publish = publishDecision({ accepted, contentType, accountIsMock: account.data.is_mock === true, testProduct: isTestProduct(product.data as Row | null),
    mediaRights, graphicOnly });
  const evidence = graphicOnly ? [{ kind: "ORIGINAL_GRAPHIC", note: "การ์ดกราฟิกที่ระบบวาดเอง ไม่มีสื่อของผู้อื่น" }, ...mediaRights] : mediaRights;
  const voice = (explanation.narration as Row | undefined)?.license;
  const row = { owner_id: owner, content_type: contentType, publish_decision: publish.decision, publish_blockers: publish.blockers,
    media_rights_evidence: voice ? [...evidence, { kind: "AI_VOICE", license: voice }] : evidence,
    creative_source: (story as { basis?: string } | undefined)?.basis?.split(/[ :(]/)[0] ?? null, tiktok_account_id: accountId, master_video_id: masterId, status: accepted ? "ACCEPTED" : "REJECTED",
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
export async function bankPackage(client: SupabaseClient, owner: string, itemId: string, options: { reviewCopy?: boolean } = {}) {
  const item = must(await client.from("content_bank_items").select("*").eq("owner_id", owner).eq("id", itemId).maybeSingle(), "BANK_ITEM_NOT_FOUND") as Row;
  if (item.status === "REJECTED" || item.status === "WITHDRAWN") throw new Error("BANK_ITEM_NOT_POSTABLE");
  // Posting packages need the owner's approval; a review copy is for watching and says it may not be posted.
  if (item.publish_decision !== "READY_TO_EXPORT" && !options.reviewCopy) throw new Error("BANK_ITEM_NOT_APPROVED_FOR_EXPORT");
  const master = must(await client.from("master_videos").select("storage_path,quality_explanation_json").eq("owner_id", owner).eq("id", String(item.master_video_id)).maybeSingle(), "BANK_MASTER_NOT_FOUND") as Row;
  const file = await client.storage.from(VIDEO_BUCKET).download(String(master.storage_path));
  if (file.error || !file.data) throw new Error("BANK_VIDEO_DOWNLOAD_FAILED");
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  assertMp4(bytes, "video/mp4");
  const copy = postCaption(String(item.caption), item.hashtags as string[]);
  const aiVoice = Boolean((master.quality_explanation_json as Row | null)?.aiGeneratedVoice);
  const manifest = { version: BANK_POLICY_VERSION, itemId, accountId: item.tiktok_account_id,
    publishDecision: item.publish_decision, ...(item.publish_decision !== "READY_TO_EXPORT" ? { doNotPost: true, doNotPostReason: item.publish_decision === "DO_NOT_PUBLISH" ? item.publish_blockers : ["OWNER_REVIEW_PENDING"] } : {}),
    contentType: item.content_type, creativeSource: item.creative_source, mediaRightsEvidence: item.media_rights_evidence,
    cost: { actualUsd: Number(item.cost_actual_usd), estimatedMachineThb: item.cost_estimated_thb, basis: item.cost_basis },
    plannedSlotAt: item.planned_slot_at, slotBasis: item.slot_basis,
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

/** The owner's review of a banked clip, as the signed-in owner (the RPC checks it is their item). */
export async function reviewBankItem(userClient: SupabaseClient, itemId: string, approve: boolean) {
  const result = await userClient.rpc("review_content_bank_item", { p_item: itemId, p_approve: approve });
  if (result.error) throw new Error(result.error.message.includes("NOT_REVIEWABLE") ? "BANK_ITEM_NOT_REVIEWABLE" : result.error.message);
  return result.data as "READY_TO_EXPORT" | "DO_NOT_PUBLISH";
}
/** After the owner posts an approved clip by hand, the post URL ties later results back to this clip. */
export async function recordBankPost(userClient: SupabaseClient, itemId: string, url: string, postedAt: Date) {
  const result = await userClient.rpc("record_content_bank_post", { p_item: itemId, p_url: url, p_posted_at: postedAt.toISOString() });
  if (result.error) throw new Error(result.error.message.includes("NOT_POSTABLE") ? "BANK_ITEM_NOT_POSTABLE" : result.error.message);
  return String(result.data);
}
