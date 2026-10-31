import { z } from "zod";

/** Limits here govern the explicitly opted-in experiment, never account registration or normal scheduling. */
export const pilotPolicySchema = z.object({
  trialClips: z.number().int().min(1).max(3).default(1),
  minimumGapMinutes: z.number().int().min(60).default(360),
  minimumPosts: z.number().int().min(6).default(6),
  minimumDays: z.number().int().min(3).default(3),
  maturationHours: z.number().min(24).default(24),
  cooldownDays: z.number().int().min(1).default(3),
  // Filled from server-side authorized observations, never a required owner choice.
  topics: z.array(z.string().trim().min(1).max(120)).default([]),
});
export type PilotPolicy = z.infer<typeof pilotPolicySchema>;
export interface GrowthPost {
  id: string; source: "TIKTOK_DISPLAY" | "MOCK"; confidence: number;
  publishedAt: string; capturedAt: string; topic: string | null;
  views: number | null; likes: number | null; comments: number | null; shares: number | null;
  averageWatchTime?: number | null; retention?: number | null; completionRate?: number | null;
  followersGained?: number | null;
}
export interface FollowerSample { at: string; count: number; source: "TIKTOK_DISPLAY" | "MOCK"; }
export interface GrowthEvidence {
  posts: GrowthPost[]; followers: FollowerSample[]; accountHealth: "READY" | "WARNING" | "BLOCKED" | "UNKNOWN";
  publicApiEligible: boolean; publishCap: number | null; publishedToday: number;
  prior: { count: number; changedAt: string; evidenceIds: string[]; reason?: string } | null;
  lastPublishedAt?: string | null;
}
export type GrowthAction = "COLD_START" | "OBSERVE" | "INCREASE" | "MAINTAIN" | "REDUCE" | "PAUSE" | "OWNER_REVIEW";
export interface GrowthDecision {
  recommended: number; action: GrowthAction; reason: string; confidence: number;
  transport: "MANUAL_PUBLIC" | "API_REVIEW"; evidenceIds: string[]; audienceMinutes: number[];
  lastPublishedAt: string | null;
  topics: { name: string; posts: number; viewsPerClip: number; followersPer1000Views: number | null }[];
  metrics: { startingFollowers: number | null; currentFollowers: number | null; netFollowers: number | null;
    viewsPerClip: number | null; followersPer1000Views: number | null; followerConversionRate: number | null;
    averageWatchTime: number | null; retention: number | null; completionRate: number | null;
    likes: number | null; comments: number | null; shares: number | null; publishedToday: number };
}
export interface GrowthSlot { ordinal: number; at: string; topic: string; brief: string; state: string; postUrl?: string | null; reportedAt?:string; }
export interface GrowthPilotView {
  available: boolean; active: boolean; name?: string; username?: string | null;
  decision?: GrowthDecision; slots?: GrowthSlot[]; message?: string;
  manualReportedToday?:number;
}
