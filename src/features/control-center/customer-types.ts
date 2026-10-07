/** Projected customer data only. Opaque locators are used by authorized actions, never displayed. */
export type CustomerPeriod = "today" | "7d" | "30d";
export type CustomerMetric = number | null;
export type CustomerPostingMode = "AUTO" | "DRAFT" | "EXPORT";
export interface CustomerPostSchedule {
  postingMode: CustomerPostingMode; creativeMode: "AUTO" | "GROWTH" | "AFFILIATE";
  clipsPerDay: number; activeStart: string; activeEnd: string; timezone: string;
  minSpacingMinutes: number; allowedDays: number[]; enabled: boolean; dailyBudgetUsd: number;
  nextRunAt: string | null;
}
export interface CustomerMetrics {
  currency: string | null;
  views: CustomerMetric; units: CustomerMetric; gmv: CustomerMetric; commission: CustomerMetric;
  liveSessions: CustomerMetric; liveHours: CustomerMetric; salesPerHour: CustomerMetric;
}
export interface CustomerAccount {
  id: string; name: string; username: string | null; avatarUrl: string | null;
  rank: number | null; connected: boolean; postStatus: string; liveStatus: string | null;
  mode: "AUTO" | "GROWTH" | "AFFILIATE"; target: number; hardLimit: number; budget: number; categories: string[];
  postCount: number;
  today: { generated: number; ready: number; published: number; waiting: number; failed: number; review: number; scheduled?: number; generating?: number };
  metrics: CustomerMetrics; currentActivity: string; nextActivity: string | null;
  actionRequired: { label: string; href: string } | null;
  nextScheduledPost: string | null; topProduct: string | null;
  /** Work slots waiting to start, kept separate from videos queued for posting. */
  schedulerQueued?: boolean; scheduleQueueCount?: number; schedulerFailureCount?: number;
  hasActiveRun?: boolean;
  /** Legacy fixture compatibility only; the current customer projection does not send run locators. */
  activeRunId?: string | null; isSingleAccountRun?: boolean;
  canStart: boolean; canStop: boolean;
  schedule?: CustomerPostSchedule;
  postingAvailability?: Record<CustomerPostingMode, { available: boolean; message: string | null }>;
}
export interface CustomerOverview {
  period: CustomerPeriod; updatedAt: string; startDate: string; endDate: string;
  accounts: CustomerAccount[];
  summary: { currency: string | null; gmv: CustomerMetric; commission: CustomerMetric; postCount: number; units: CustomerMetric;
    views: CustomerMetric; liveSessions: CustomerMetric; liveHours: CustomerMetric; salesPerHour: CustomerMetric };
  analyticsNotice: string;
}
export interface CustomerClip {
  currency: string | null;
  key: string; title: string; product: string | null; thumbnail: string | null; status: string;
  scheduledAt: string | null; postedAt: string | null; views: CustomerMetric; sales: CustomerMetric;
  canRetry: boolean; queueId: string | null;
  caption?: string | null; hashtags?: string[]; videoUrl?: string | null;
  postingMode?: CustomerPostingMode; downloadUrl?: string | null;
  reviewRequired?: boolean; reviewUrl?: string | null; result?: string | null;
}
export interface CustomerPostAccount {
  account: CustomerAccount; clips: CustomerClip[]; period: CustomerPeriod; updatedAt: string;
}
