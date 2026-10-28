import type { FlowAccountRow } from "./contracts";

export interface FlowAccountView {
  id: string; label: string; priority: number; active: boolean; clipsPerDayEstimate: number;
  exhaustedToday: boolean; clipsToday: number; remainingEstimate: number;
}

/** Accounts in drain order (priority, then oldest) with today's usage; counters from earlier days read as zero. */
export function flowAccountViews(rows: FlowAccountRow[], today: string): FlowAccountView[] {
  return rows.toSorted((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map(row => {
      const clipsToday = row.clips_today_on === today ? row.clips_today : 0;
      const exhaustedToday = row.exhausted_on === today;
      return { id: row.id, label: row.label, priority: row.priority, active: row.active, clipsPerDayEstimate: row.clips_per_day_estimate,
        exhaustedToday, clipsToday, remainingEstimate: !row.active || exhaustedToday ? 0 : Math.max(0, row.clips_per_day_estimate - clipsToday) };
    });
}

/** Roughly how many more clips the active accounts can make today. An estimate: Flow's own credit count decides. */
export function remainingCapacity(views: FlowAccountView[]) {
  return views.reduce((sum, view) => sum + view.remainingEstimate, 0);
}

/** The account the worker should use next: the first active one Flow has not reported empty today. */
export function nextFlowAccount(views: FlowAccountView[]) {
  return views.find(view => view.active && !view.exhaustedToday) ?? null;
}

/** How many new clips one click should add so the day's total reaches the target, never past the batch limit. */
export function clipsToAdd(target: number, alreadyToday: number, maxPerBatch: number) {
  return Math.max(0, Math.min(maxPerBatch, Math.floor(target) - Math.max(0, alreadyToday)));
}
