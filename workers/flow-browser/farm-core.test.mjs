import test from "node:test";
import assert from "node:assert/strict";
import { appeared, costDecision, NO_CREDIT_PATTERNS, newVideoSources, parseCreditCost, runFarmPass, runLoginPass } from "./farm-core.mjs";

test("reads Flow's credit cost in Thai and English", () => {
  assert.equal(parseCreditCost("x1 x2\nการสร้างจะใช้ 10 เครดิต"), 10);
  assert.equal(parseCreditCost("This generation will use 1,000 credits"), 1000);
  assert.equal(parseCreditCost("วิดีโอ · 720p · 8 วินาที"), null);
});

test("never spends above the per-clip ceiling and stops when the cost cannot be read", () => {
  assert.deepEqual(costDecision(10, { maxCredits: 10 }), { ok: true });
  assert.equal(costDecision(20, { maxCredits: 10 }).ok, false);
  assert.equal(costDecision(null).reason, "COST_UNREADABLE");
  assert.equal(costDecision(null, { requireKnownCost: false }).ok, true);
});

test("only counts credit notices that appear after the click", () => {
  assert.equal(appeared("เครดิตไม่พอ", "เครดิตไม่พอ", NO_CREDIT_PATTERNS), false);
  assert.equal(appeared("", "Not enough credits to generate", NO_CREDIT_PATTERNS), true);
  assert.deepEqual(newVideoSources(["a"], ["a", "b", "b"]), ["b"]);
});

/** Fake portal + Flow: each account has a number of clips its credits pay for. */
function farm({ accounts, queue, credits, broken = {}, failures = {} }) {
  const state = { queue: queue.map((title, i) => ({ id: `c${i}`, title, prompt: "p" })), library: [], back: [], failed: [], exhausted: [], skipped: 0, opened: [] };
  const api = {
    accounts: async () => accounts.map(id => ({ id, label: id, active: true, exhaustedToday: false })),
    claim: async () => state.queue.shift() ?? null,
    upload: async clip => { state.library.push(clip.id); },
    fail: async (id, reason, notStarted) => {
      if (notStarted) state.queue.unshift({ id, title: id, prompt: "p" }); else state.failed.push({ id, reason });
    },
    exhausted: async id => { state.exhausted.push(id); },
    // Mirrors skip_unreachable_flow_clips for unlinked accounts: skip only when every account is out of credits.
    finish: async () => {
      if (!accounts.every(id => state.exhausted.includes(id))) return { skipped: 0 };
      state.skipped = state.queue.length; state.queue = []; return { skipped: state.skipped };
    },
  };
  const openAccount = async account => {
    if (broken[account.id]) throw new Error(broken[account.id]);
    state.opened.push(account.id);
    let left = credits[account.id] ?? 0, failLeft = failures[account.id] ?? 0;
    return {
      generate: async () => {
        if (failLeft-- > 0) return { status: "FAILED", reason: "FLOW_REPORTED_FAILURE", started: true };
        if (left <= 0) return { status: "NO_CREDIT" };
        left--; return { status: "OK", path: "x", sha256: "0".repeat(64), media: { width: 720, height: 1280, durationSeconds: 8 } };
      },
      close: async () => {},
    };
  };
  return { state, deps: { api, openAccount } };
}
const titles = n => Array.from({ length: n }, (_, i) => `clip ${i + 1}`);

test("three accounts with 5 credits each make all 15 clips, draining the first before the second", async () => {
  const { state, deps } = farm({ accounts: ["a", "b", "c"], queue: titles(15), credits: { a: 5, b: 5, c: 5 } });
  const summary = await runFarmPass(deps);
  assert.equal(summary.made, 15);
  assert.deepEqual(state.exhausted, ["a", "b"]);
  assert.deepEqual(state.library.slice(0, 5), ["c0", "c1", "c2", "c3", "c4"]);
  assert.equal(summary.stoppedBy, "QUEUE_EMPTY");
});

test("an account signed in on another computer signs in again on this one", async () => {
  const signedIn = [];
  const api = { accounts: async () => [{ id: "here", label: "here", loginState: "READY" }, { id: "elsewhere", label: "elsewhere", loginState: "READY" },
    { id: "failed", label: "failed", loginState: "FAILED" }], login: async () => {} };
  await runLoginPass({ api, hasProfile: async account => account.id === "here", signIn: async account => { signedIn.push(account.id); return { state: "READY" }; } });
  assert.deepEqual(signedIn, ["elsewhere"]);
});

test("one account with 5 credits makes 5 clips and skips the rest of the day's queue", async () => {
  const { state, deps } = farm({ accounts: ["a"], queue: titles(15), credits: { a: 5 } });
  const summary = await runFarmPass(deps);
  assert.equal(summary.made, 5);
  assert.equal(summary.stoppedBy, "ALL_CREDITS_USED");
  assert.equal(state.skipped, 10);
});

test("a rich main account is used up before the next one is opened", async () => {
  const { state, deps } = farm({ accounts: ["main", "spare"], queue: titles(12), credits: { main: 50, spare: 5 } });
  await runFarmPass(deps);
  assert.equal(state.library.length, 12);
  assert.deepEqual(state.opened, ["main"]);
});

test("a signed-out account is skipped without throwing the queue away", async () => {
  const { state, deps } = farm({ accounts: ["a", "b"], queue: titles(4), credits: { b: 2 }, broken: { a: "FLOW_LOGIN_REQUIRED" } });
  const summary = await runFarmPass(deps);
  assert.equal(summary.made, 2);
  assert.equal(summary.stoppedBy, "ACCOUNTS_NEED_ATTENTION");
  assert.equal(state.skipped, 0);
  assert.equal(state.queue.length, 2);
});

test("a generation Flow accepted but failed is not retried automatically", async () => {
  const { state, deps } = farm({ accounts: ["a"], queue: titles(3), credits: { a: 5 }, failures: { a: 1 } });
  const summary = await runFarmPass(deps);
  assert.equal(summary.made, 2);
  assert.deepEqual(state.failed.map(f => f.id), ["c0"]);
});

test("an idle queue never opens a browser", async () => {
  const { state, deps } = farm({ accounts: ["a"], queue: [], credits: { a: 5 } });
  assert.equal((await runFarmPass(deps)).stoppedBy, "QUEUE_EMPTY");
  assert.deepEqual(state.opened, []);
});

test("signs newly linked Google accounts in one at a time and only then lets them make clips", async () => {
  const calls = [];
  const accounts = [{ id: "a", label: "a", loginState: "READY" }, { id: "b", label: "b", loginState: "PENDING" },
    { id: "c", label: "c", loginState: "PENDING" }, { id: "d", label: "d", loginState: "PENDING", active: false }];
  const api = { accounts: async () => accounts, login: async (id, state, note) => { calls.push(["login", id, state, note]); } };
  let open = 0;
  const handled = await runLoginPass({ api, signIn: async account => {
    assert.equal(open++, 0, "one sign-in window at a time");
    calls.push(["signIn", account.id]);
    open--;
    if (account.id === "c") throw new Error("ไม่ได้ล็อกอินภายใน 15 นาที");
    return { state: "READY", note: "10 เครดิต/คลิป" };
  } });
  assert.equal(handled, 2);
  assert.deepEqual(calls, [["signIn", "b"], ["login", "b", "READY", "10 เครดิต/คลิป"], ["signIn", "c"], ["login", "c", "FAILED", "ไม่ได้ล็อกอินภายใน 15 นาที"]]);

  const claimed = [];
  const summary = await runFarmPass({ api: { accounts: async () => accounts, claim: async id => { claimed.push(id); return null; }, finish: async () => ({ skipped: 0 }) },
    openAccount: async () => { throw new Error("not reached"); } });
  assert.deepEqual(claimed, ["a"]);
  assert.equal(summary.stoppedBy, "QUEUE_EMPTY");
});
