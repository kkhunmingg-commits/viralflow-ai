/**
 * Flow farm core: the decisions the local semi-auto worker makes, kept free of the browser so they can be
 * tested with fakes. The browser side (farm-driver.mjs) only reports what Flow showed.
 *
 * Order of work: Google accounts are drained one at a time in the owner's order, each making only its own
 * TikTok account's clips (shared accounts make anyone's). An account is used until Flow says its credits are
 * gone or its TikTok account has nothing queued, then the worker moves on. Clips no account with credits left
 * may make are skipped for the day and whatever was made stays in the library. A clip whose Generate click may have reached
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
  // Only accounts the computer has seen signed in make clips; PENDING ones are signed in first by runLoginPass.
  const accounts = (await api.accounts()).filter(account => account.active !== false && (account.loginState ?? "READY") === "READY");
  if (!accounts.length) { summary.stoppedBy = "NO_FLOW_ACCOUNTS"; return summary; }
  for (const account of accounts) {
    if (account.exhaustedToday) { summary.exhaustedAccounts.push(account.id); continue; }
    // The browser opens only once there is a clip to make, so an idle --watch never starts Chrome.
    let session = null, failures = 0, accountDone = false;
    try {
      while (!accountDone) {
        if (options.maxClips && summary.made >= options.maxClips) { summary.stoppedBy = "MAX_CLIPS"; return summary; }
        // Nothing left that this Google account may make (its TikTok account is done): try the next account.
        const clip = await api.claim(account.id);
        if (!clip) break;
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
  // The server skips only queued clips that no Google account with credits left may make, so what was made
  // stays and a signed-out or broken account leaves its clips waiting for the owner to fix it.
  const finished = await api.finish();
  summary.skipped = finished?.skipped ?? 0;
  if (accounts.every(account => summary.exhaustedAccounts.includes(account.id))) summary.stoppedBy = "ALL_CREDITS_USED";
  else if (summary.brokenAccounts.length) summary.stoppedBy = "ACCOUNTS_NEED_ATTENTION";
  else { summary.queueEmpty = true; summary.stoppedBy = "QUEUE_EMPTY"; }
  if (summary.skipped) log(`เครดิตหมด ได้ ${summary.made} คลิป ข้ามที่เหลือ ${summary.skipped} คลิป`);
  return summary;
}

/**
 * Signs in Google accounts the owner just linked, one at a time, before any clip is made.
 * deps.signIn(account) → { state: "READY" | "FAILED", note? }: checks the saved profile out of sight and only shows a
 * sign-in window when the account is not signed in yet. Returns how many accounts were handled.
 */
export async function runLoginPass(deps) {
  const { api, signIn, log = () => {} } = deps;
  const pending = (await api.accounts()).filter(account => account.active !== false && account.loginState === "PENDING");
  for (const account of pending) {
    log(`[${account.label}] ตรวจ/เปิดหน้าล็อกอิน Google`);
    let result;
    try { result = await signIn(account); }
    catch (error) { result = { state: "FAILED", note: message(error).slice(0, 200) }; }
    await api.login(account.id, result.state, result.note);
    log(`[${account.label}] ${result.state === "READY" ? "ล็อกอินแล้ว พร้อมสร้างคลิป" : `ล็อกอินไม่สำเร็จ: ${result.note ?? ""}`}`);
  }
  return pending.length;
}

export function message(error) { return error instanceof Error ? error.message : String(error); }
