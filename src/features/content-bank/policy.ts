import { createHash } from "node:crypto";

/** Pure decisions for the content bank: what counts as the same clip, when to post it, what it cost. */
export const BANK_POLICY_VERSION = "content-bank-v1";

const norm = (text: string) => text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
/** Two scripts that say the same thing in the same order are one clip, whatever the render. */
export function creativeFingerprint(lines: string[]) {
  return createHash("sha256").update(JSON.stringify(lines.map(norm).filter(Boolean))).digest("hex");
}

export interface AcceptanceInput {
  masterStatus: string; qualityStatus: string;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
  rightsViolations: string[]; duplicateOf: string | null; narrationKind: string | null;
}
/** Machine acceptance into the bank. It repeats every QC check rather than trusting a score, and it
 * is explicitly not the owner's review: a banked clip still needs a person before it is posted. */
export function bankAcceptance(input: AcceptanceInput) {
  const reasons: string[] = [];
  if (!["READY", "APPROVED"].includes(input.masterStatus)) reasons.push(`MASTER_NOT_READY:${input.masterStatus}`);
  if (input.qualityStatus !== "PASS") reasons.push(`QUALITY_${input.qualityStatus}`);
  for (const c of input.checks) if (!c.passed) reasons.push(`CHECK_FAILED:${c.name}`);
  if (!input.checks.some(c => c.name === "PACING")) reasons.push("EDIT_CHECKS_MISSING");
  for (const v of input.rightsViolations) reasons.push(`RIGHTS:${v}`);
  if (input.duplicateOf) reasons.push(`DUPLICATE_OF:${input.duplicateOf}`);
  if (input.narrationKind === "NONE") reasons.push("NO_NARRATION");
  // Caption-only is allowed by the renderer for planned text-first cuts, but the bank wants a voiced clip;
  // a render that fell back to captions (for example after a failed TTS take) goes back for another render.
  if (input.narrationKind === "CAPTION_ONLY") reasons.push("NARRATION_FELL_BACK_TO_CAPTIONS");
  return { accepted: reasons.length === 0, reasons };
}

/** Account-level tags from the owner's automation categories, merged with the clip's own. */
export function bankHashtags(clipTags: string[], categories: string[]) {
  const tag = (t: string) => `#${t.replace(/^#+/, "").replace(/[^\p{L}\p{N}\p{M}_]/gu, "")}`;
  return [...new Set([...clipTags.map(tag), ...categories.map(tag)])].filter(t => t.length > 1).slice(0, 6);
}

/** Local minute-of-day and date parts for a time zone, without a date library. */
function localParts(at: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(at).map(p => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), minute: Number(parts.hour) * 60 + Number(parts.minute) };
}
function zonedTime(y: number, m: number, d: number, minute: number, timeZone: string) {
  // Start from the UTC guess and correct by the zone's offset at that moment.
  const guess = Date.UTC(y, m - 1, d, Math.floor(minute / 60), minute % 60);
  const local = localParts(new Date(guess), timeZone), shown = Date.UTC(local.y, local.m - 1, local.d, Math.floor(local.minute / 60), local.minute % 60);
  return new Date(guess - (shown - guess));
}
/** Without enough of the account's own posting history there is no evidence for a best time, so the
 * bank uses plain lunchtime/evening defaults and says so instead of presenting them as learned. */
export const DEFAULT_SLOT_MINUTES = [12 * 60 + 15, 19 * 60 + 30];

export function planBankSlot(input: { now: Date; timeZone: string; audienceMinutes: number[]; taken: Date[];
  minGapMinutes: number; dailyTarget: number; leadMinutes?: number }) {
  const learned = input.audienceMinutes.filter(m => Number.isInteger(m) && m >= 0 && m < 1440);
  const minutes = (learned.length ? learned : DEFAULT_SLOT_MINUTES).toSorted((a, b) => a - b);
  const basis: "AUDIENCE_DATA" | "DEFAULT_NO_DATA" = learned.length ? "AUDIENCE_DATA" : "DEFAULT_NO_DATA";
  const earliest = input.now.getTime() + (input.leadMinutes ?? 60) * 60000, gap = Math.max(1, input.minGapMinutes) * 60000;
  const today = localParts(input.now, input.timeZone), perDay = Math.max(1, input.dailyTarget);
  for (let day = 0; day < 30; day++) {
    const date = new Date(Date.UTC(today.y, today.m - 1, today.d + day));
    const dayStart = zonedTime(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 0, input.timeZone).getTime();
    const sameDay = input.taken.filter(t => t.getTime() >= dayStart && t.getTime() < dayStart + 86400000).length;
    if (sameDay >= perDay) continue;
    for (const minute of minutes) {
      const at = zonedTime(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), minute, input.timeZone);
      if (at.getTime() < earliest || input.taken.some(t => Math.abs(t.getTime() - at.getTime()) < gap)) continue;
      return { at, basis };
    }
  }
  return { at: null, basis };
}

/** Machine time is not billed in this setup; with an hourly rate it becomes an estimate, never spend. */
/** Machine time for one clip. Planning time (a local language model) is counted when it was measured and said
 * to be missing when it was not, so a cheap-looking render estimate never hides the model's share. */
export function machineCostEstimate(renderSeconds: number | null, thbPerHour: number | null, planningSeconds: number | null = null) {
  if (renderSeconds === null || !Number.isFinite(renderSeconds) || thbPerHour === null || !Number.isFinite(thbPerHour) || thbPerHour < 0)
    return { thb: null, basis: "ESTIMATE_UNAVAILABLE: no machine rate configured" };
  const planning = planningSeconds !== null && Number.isFinite(planningSeconds) && planningSeconds >= 0 ? planningSeconds : null;
  return { thb: Number(((renderSeconds + (planning ?? 0)) / 3600 * thbPerHour).toFixed(4)),
    basis: `ESTIMATE: ${renderSeconds.toFixed(0)} s render ${planning === null ? "(planning time not measured)" : `+ ${planning.toFixed(0)} s planning`} at ${thbPerHour} THB/hour` };
}

/** Cost per usable clip counts every attempt, accepted or not, against the clips that were accepted. */
export function bankCostSummary(items: Array<{ status: string; cost_actual_usd: number; cost_estimated_thb: number | null }>, thbPerUsd: number | null) {
  const usable = items.filter(i => i.status !== "REJECTED").length, actualUsd = items.reduce((a, i) => a + Number(i.cost_actual_usd), 0);
  const estimates = items.map(i => i.cost_estimated_thb), estimatedThb = estimates.every(e => e !== null) ? estimates.reduce((a, e) => a + Number(e), 0) : null;
  return { attempts: items.length, usable, rejected: items.length - usable, actualUsd,
    actualThbPerUsable: usable && thbPerUsd !== null ? actualUsd * thbPerUsd / usable : null,
    estimatedThbPerUsable: usable && estimatedThb !== null ? estimatedThb / usable : null };
}

export type PublishDecision = "PENDING_REVIEW" | "READY_TO_EXPORT" | "DO_NOT_PUBLISH";
/** What the bank lets the owner do with a clip. Only the owner's review moves PENDING_REVIEW to
 * READY_TO_EXPORT; test media and rejected renders are blocked whatever the review says. */
export function publishDecision(input: { accepted: boolean; contentType: "GROWTH" | "AFFILIATE"; accountIsMock: boolean; testProduct: boolean;
  mediaRights: Array<{ allowsCommercial: boolean; allowsPromotion: boolean; testOnly: boolean }>; graphicOnly: boolean }) {
  const blockers: string[] = [];
  if (!input.accepted) blockers.push("MACHINE_REJECTED");
  if (input.accountIsMock) blockers.push("MOCK_ACCOUNT");
  // A test product's media and claims describe nothing a viewer could buy; publishing it would mislead.
  if (input.contentType === "AFFILIATE" && input.testProduct) blockers.push("TEST_PRODUCT_MEDIA_NOT_FOR_PUBLISHING");
  if (input.mediaRights.some(r => r.testOnly)) blockers.push("TEST_MEDIA_NOT_FOR_PUBLISHING");
  if (!input.graphicOnly && !input.mediaRights.length) blockers.push("NO_MEDIA_RIGHTS_EVIDENCE");
  if (input.mediaRights.some(r => !r.allowsCommercial || input.contentType === "AFFILIATE" && !r.allowsPromotion)) blockers.push("MEDIA_RIGHTS_DO_NOT_COVER_USE");
  return { decision: (blockers.length ? "DO_NOT_PUBLISH" : "PENDING_REVIEW") as PublishDecision, blockers };
}
/** A product counts as test data when its provider or metadata says so; real catalogue products never carry these marks. */
export const isTestProduct = (product: { external_provider?: unknown; provider_metadata?: unknown } | null) =>
  !product || /mock|pilot|test/i.test(String(product.external_provider ?? "")) || (product.provider_metadata as { pilot?: unknown } | null)?.pilot === true;
/** Rights records written for pipeline tests say so in their reference. */
export const isTestRights = (reference: string) => /not for publishing|ห้ามเผยแพร่|test only/i.test(reference);
