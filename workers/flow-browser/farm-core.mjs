/**
 * Flow farm core: the decisions the local semi-auto worker makes, kept free of the browser so they can be
 * tested with fakes. The browser side (farm-driver.mjs) only reports what Flow showed.
 *
 * Order of work: accounts are drained one at a time in the owner's order. An account is used until Flow says
 * its credits are gone, then the worker moves to the next. When every account is out, today's remaining
 * queue is skipped and whatever was made stays in the library. A clip whose Generate click may have reached
 * Google is never submitted again.
 */

// Flow's own wording when an account cannot pay for a generation (Thai and English UI).
export const NO_CREDIT_PATTERNS = [
  /เครดิต(?:ของคุณ)?(?:ไม่พอ|ไม่เพียงพอ|หมด)/, /ไม่มีเครดิต/, /ใช้เครดิตครบ/,
  /not enough (?:ai )?credits/i, /insufficient credits/i, /out of (?:ai )?credits/i, /(?:ran|run) out of credits/i,
  /no (?:ai )?credits (?:left|remaining)/i, /credit limit reached/i,
];
// Flow's wording when a generation it accepted did not produce a video.
export const FAILED_PATTERNS = [
  /สร้างไม่สำเร็จ/, /สร้าง(?:วิดีโอ)?ไม่ได้/, /เกิดข้อผิดพลาด/, /ล้มเหลว/, /ละเมิดนโยบาย/,
  /generation failed/i, /couldn['’]t generate/i, /could not generate/i, /something went wrong/i, /violat\w* (?:our )?(?:policies|policy)/i,
];
export const SIGN_IN_HOSTS = ["accounts.google.com"];

export function countMatches(text, patterns) {
  return patterns.reduce((sum, pattern) => sum + (String(text).match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"))?.length ?? 0), 0);
}
/** True when `after` shows more of the pattern than `before` — new wording since the click, not old history. */
export function appeared(before, after, patterns) {
  return countMatches(after, patterns) > countMatches(before, patterns);
}

/** Reads "การสร้างจะใช้ 10 เครดิต" / "This generation will use 20 credits". Null when the page does not say. */
export function parseCreditCost(text) {
  const value = String(text);
  const match = value.match(/(?:จะใช้|ใช้)\s*([\d,]+)\s*เครดิต/) ?? value.match(/will use\s*([\d,]+)\s*credits?/i)
    ?? value.match(/([\d,]+)\s*credits?\s*(?:per|for this) generation/i);
  if (!match) return null;
  const cost = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(cost) && cost >= 0 ? cost : null;
}

/** Free-first guard: never click Generate for more than the owner's ceiling (default 10 = Veo 3.1 Lite, 1 output). */
export function costDecision(cost, { maxCredits = 10, requireKnownCost = true } = {}) {
  if (cost == null) return requireKnownCost ? { ok: false, reason: "COST_UNREADABLE" } : { ok: true };
  if (cost > maxCredits) return { ok: false, reason: `COST_${cost}_ABOVE_LIMIT_${maxCredits}` };
  return { ok: true };
}

export function newVideoSources(before, after) {
  const seen = new Set(before);
  return [...new Set(after)].filter(src => typeof src === "string" && src && !seen.has(src));
}

/**
 * Runs one pass over the queue.
 * deps.api: accounts(), claim(accountId), upload(clip, result), fail(clipId, reason, notStarted), exhausted(accountId), finish()
 * deps.openAccount(account) → { generate(clip) → {status:"OK", ...} | {status:"NO_CREDIT"} | {status:"FAILED", reason, started}, close() }
 * Returns a summary. `dryRun` stops after preparing one clip without clicking Generate.
 */
export async function runFarmPass(deps, options = {}) {
  const { api, openAccount, log = () => {} } = deps;
  const maxConsecutiveFailures = options.maxConsecutiveFailures ?? 3;
  const summary = { made: 0, failed: 0, exhaustedAccounts: [], brokenAccounts: [], queueEmpty: false, skipped: 0, stoppedBy: null };
  const accounts = (await api.accounts()).filter(account => account.active !== false);
  if (!accounts.length) { summary.stoppedBy = "NO_FLOW_ACCOUNTS"; return summary; }
  for (const account of accounts) {
    if (account.exhaustedToday) { summary.exhaustedAccounts.push(account.id); continue; }
    // The browser opens only once there is a clip to make, so an idle --watch never starts Chrome.
    let session = null, failures = 0, accountDone = false;
    try {
      while (!accountDone) {
        if (options.maxClips && summary.made >= options.maxClips) { summary.stoppedBy = "MAX_CLIPS"; return summary; }
        const clip = await api.claim(account.id);
        if (!clip) { summary.queueEmpty = true; summary.stoppedBy = "QUEUE_EMPTY"; return summary; }
        if (!session) {
          try { session = await openAccount(account); }
          catch (error) {
            await api.fail(clip.id, "BROWSER_UNAVAILABLE", true);
            log(`[${account.label}] เปิด Flow ไม่ได้: ${message(error)}`);
            summary.brokenAccounts.push({ id: account.id, reason: message(error) });
            break;
          }
        }
        log(`[${account.label}] กำลังสร้าง: ${clip.title}`);
        let result;
        try { result = await session.generate(clip); }
        catch (error) { result = { status: "FAILED", reason: message(error), started: Boolean(error?.started) }; }
        if (result.status === "OK") {
          try {
            await api.upload(clip, result);
            summary.made++; failures = 0;
            log(`[${account.label}] เสร็จ เข้าคลังแล้ว (${summary.made})`);
          } catch (error) {
            summary.failed++;
            log(`[${account.label}] ส่งเข้าคลังไม่สำเร็จ: ${message(error)} (ไฟล์ยังอยู่ในเครื่อง)`);
            await api.fail(clip.id, `UPLOAD_FAILED:${message(error)}`.slice(0, 300), false).catch(() => {});
          }
        } else if (result.status === "NO_CREDIT") {
          // Flow refused before taking the job: the clip goes back for the next account.
          await api.fail(clip.id, "NO_CREDIT", true);
          await api.exhausted(account.id);
          summary.exhaustedAccounts.push(account.id);
          log(`[${account.label}] เครดิตหมด → ย้ายไปบัญชีถัดไป`);
          accountDone = true;
        } else if (result.status === "DRY_RUN") {
          await api.fail(clip.id, "DRY_RUN", true);
          summary.stoppedBy = "DRY_RUN";
          log(`[${account.label}] ทดสอบแบบไม่กด Generate: ${result.detail ?? "พร้อม"}`);
          return summary;
        } else {
          summary.failed++; failures++;
          await api.fail(clip.id, String(result.reason ?? "FAILED").slice(0, 300), !result.started);
          log(`[${account.label}] ไม่สำเร็จ: ${result.reason}${result.started ? " (ไม่สร้างซ้ำอัตโนมัติ)" : ""}`);
          if (!result.started && /^COST_|LOGIN|PROMPT_BOX|GENERATE_BUTTON/.test(String(result.reason))) {
            // A setup problem on this account (wrong model, signed out, page changed): try the next account.
            summary.brokenAccounts.push({ id: account.id, reason: result.reason });
            accountDone = true;
          } else if (failures >= maxConsecutiveFailures) {
            summary.brokenAccounts.push({ id: account.id, reason: "TOO_MANY_FAILURES" });
            accountDone = true;
          }
        }
      }
    } finally { await session?.close().catch(() => {}); }
  }
  // Every account was used up or unusable. Only an all-out-of-credits day skips the rest of the queue;
  // a signed-out or broken account leaves the queue for the owner to fix.
  if (accounts.every(account => summary.exhaustedAccounts.includes(account.id))) {
    const finished = await api.finish();
    summary.skipped = finished?.skipped ?? 0;
    summary.stoppedBy = "ALL_CREDITS_USED";
    log(`เครดิตทุกบัญชีหมด ได้ ${summary.made} คลิปวันนี้ ข้ามที่เหลือ ${summary.skipped} คลิป`);
  } else summary.stoppedBy = "ACCOUNTS_NEED_ATTENTION";
  return summary;
}

export function message(error) { return error instanceof Error ? error.message : String(error); }
