import type { PlannedWork, SchedulerAccount } from "./contracts";

const formatters = new Map<string, Intl.DateTimeFormat>();
const parts = (at: Date, timezone: string) => {
  let formatter = formatters.get(timezone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}); formatters.set(timezone, formatter); }
  return Object.fromEntries(formatter.formatToParts(at).map(p => [p.type, p.value]));
};
export function localDay(at: Date, timezone: string) {
  const p = parts(at, timezone); return `${p.year}-${p.month}-${p.day}`;
}
/** Converts a calendar midnight without assuming fixed offsets; DST days may have 23/25 hours. */
export function dayBounds(day: string, timezone: string) {
  function midnight(value: string) {
    const target = Date.parse(`${value}T00:00:00Z`); let stamp = target;
    for (let n = 0; n < 6; n++) {
      const p = parts(new Date(stamp), timezone);
      const displayed = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
      const next = stamp + target - displayed; if (next === stamp) break; stamp = next;
    }
    return stamp;
  }
  const tomorrow = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return { start: midnight(day), end: midnight(tomorrow) };
}
const hash = (value: string) => [...value].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 0);
function random(seed: string) { let state=hash(seed);return()=>{state+=0x6d2b79f5;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;}; }

export class MultiAccountPublishingScheduler {
  plan(accounts: SchedulerAccount[], now: Date, preproduceMinutes = 180): PlannedWork[] {
    const result: PlannedWork[] = [];
    for (const account of accounts) {
      const c = account.config; if (!c.enabled || c.paused || !account.connected || account.hidden) continue;
      const day = localDay(now, c.timezone), bounds = dayBounds(day, c.timezone);
      const eligible: number[] = [];
      for (let t = bounds.start; t < bounds.end; t += 60000) {
        const p = parts(new Date(t), c.timezone), minute = Number(p.hour) * 60 + Number(p.minute);
        if (c.spreadFullDay || c.windows.some(w => minute >= w.start && minute < w.end)) eligible.push(t);
      }
      const target = account.recommendation.generation, jitter=random(`${account.scheduleSeed}:${day}`);
      // Jitter may vary a slot, but cannot bunch adjacent slots at a stratum boundary.
      // This is a cadence-derived spacing rule, not a fixed daily clip quota.
      const gapMinutes = Math.max(c.minimumGapMinutes, Math.floor(eligible.length / Math.max(1, target * 2)));
      let last=-Infinity;
      for (let ordinal = 0; ordinal < target; ordinal++) {
        const start = Math.floor(ordinal * eligible.length / target), end = Math.floor((ordinal + 1) * eligible.length / target);
        const candidates = eligible.slice(start, Math.max(start + 1, end));
        const audience = candidates.filter(t => { const p = parts(new Date(t), c.timezone); return c.audienceMinutes.includes(Number(p.hour) * 60 + Number(p.minute)); });
        const spaced = candidates.filter(t=>t-last>=gapMinutes*60000);
        const preferred = audience.filter(t=>t-last>=gapMinutes*60000);
        const times = preferred.length ? preferred : spaced;
        if (!times.length) continue;
        const due = times[Math.floor(jitter()*times.length)];last=due;
        result.push({ ownerId: account.ownerId, accountId: account.id, day, ordinal: ordinal + 1, kind: "GENERATE",
          dueAt: new Date(due).toISOString(), availableAt: new Date(due - preproduceMinutes * 60000).toISOString(), priority: c.priority });
      }
    }
    return result.sort((a, b) => a.dueAt.localeCompare(b.dueAt) || b.priority - a.priority || a.accountId.localeCompare(b.accountId));
  }
}

export function capacityEstimate(accounts: SchedulerAccount[], actualUnitCost: number | null) {
  const enabled = accounts.filter(a => a.config.enabled && !a.config.paused && a.connected && !a.hidden);
  return { generationTarget: enabled.reduce((n, a) => n + a.recommendation.generation, 0), publishingTarget: enabled.reduce((n, a) => n + a.recommendation.publishing, 0),
    shortage: enabled.reduce((n, a) => n + Math.max(0, a.recommendation.publishing - a.ready), 0),
    ready: enabled.reduce((n, a) => n + a.ready, 0), automatedGoogleCapacity: null,
    estimatedCost: actualUnitCost === null ? null : enabled.reduce((n, a) => n + a.recommendation.generation, 0) * actualUnitCost };
}
