import { z } from "zod";

/**
 * Praew's live show runs on the owner's PC (D:\ViralFlowAI\workspace\presenter-lab\live). A small bridge there polls
 * this app: it picks up what the owner pressed on the AI LIVE page and reports back what the show is doing.
 * Both sides are small JSON files in the private state bucket, so no database table is needed.
 */
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("stop") }),
  z.object({ type: z.literal("say"), text: z.string().trim().min(1).max(300) }),
  z.object({ type: z.literal("skip") }),
  z.object({ type: z.literal("clear") }),
  z.object({ type: z.literal("idle") }),
  z.object({ type: z.literal("mute"), on: z.boolean() }),
  z.object({ type: z.literal("chatter"), on: z.boolean() }),
  z.object({ type: z.literal("overlay"), on: z.boolean() }),
  // Praew presents the products the owner posted for sale (TikTok Shop best-sellers first, then link-clip products).
  z.object({ type: z.literal("products"), on: z.boolean() }),
  z.object({ type: z.literal("voice"), name: z.enum(["vachana-f1", "vachana-f2", "vachana-f1-jane", "vachana-f2-jane", "edge-premwadee", "test-voice"]) }),
  // One live system, two picture engines: "pro" = smooth realtime (strong GPU), "lite" = looping clips (low-spec PCs).
  z.object({ type: z.literal("engine"), name: z.enum(["pro", "lite"]) }),
  // Which installed Lite presenter pack the Lite engine shows (a folder name the PC reported).
  z.object({ type: z.literal("litePresenter"), folder: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/) }),
  z.object({ type: z.literal("followers"), count: z.number().int().min(0).max(10_000_000) }),
  z.object({ type: z.literal("tiktok"), username: z.string().trim().transform(v => v.replace(/^@/, "")).pipe(z.string().regex(/^[A-Za-z0-9._]{0,24}$/)) }),
]);
export type PraewCommand = z.infer<typeof commandSchema>;
export type LiveEngine = "pro" | "lite";
export type QueuedCommand = PraewCommand & { id: number; at: string };

/** What the page asked for: the bridge runs commands with id above the last one it ran. */
export interface PraewDesired {
  seq: number;
  commands: QueuedCommand[];
  settings: { running: boolean; muted: boolean; chatter: boolean; overlay: boolean; tiktok: string; followers: number | null; voice?: string; products?: boolean; engine?: LiveEngine; litePresenter?: string };
}
export const emptyDesired = (): PraewDesired => ({ seq: 0, commands: [], settings: { running: false, muted: false, chatter: true, overlay: true, tiktok: "", followers: null } });
const KEEP_COMMANDS = 40;

/** Adds a command and updates the settings it changes; old commands fall off once the bridge must have seen them. */
export function enqueue(desired: PraewDesired, command: PraewCommand, now = new Date()): PraewDesired {
  const id = desired.seq + 1;
  const settings = { ...emptyDesired().settings, ...desired.settings };
  if (command.type === "start") settings.running = true;
  if (command.type === "stop") settings.running = false;
  if (command.type === "mute") settings.muted = command.on;
  if (command.type === "chatter") settings.chatter = command.on;
  if (command.type === "tiktok") settings.tiktok = command.username;
  if (command.type === "overlay") settings.overlay = command.on;
  if (command.type === "products") settings.products = command.on;
  if (command.type === "voice") settings.voice = command.name;
  if (command.type === "followers") settings.followers = command.count;
  if (command.type === "engine") settings.engine = command.name;
  if (command.type === "litePresenter") settings.litePresenter = command.folder;
  return { seq: id, settings, commands: [...desired.commands, { ...command, id, at: now.toISOString() }].slice(-KEEP_COMMANDS) };
}
export const commandsAfter = (desired: PraewDesired, after: number) => desired.commands.filter(c => c.id > after);

const line = z.object({ text: z.string().max(400), at: z.string().max(40).nullish(), source: z.string().max(20).nullish() });
const comment = z.object({ user: z.string().max(60), text: z.string().max(300), verdict: z.string().max(20).nullish(), at: z.string().max(40).nullish() });
const num = z.number().finite().nullable().optional();

/** What the bridge reports every few seconds. Every field is optional so an older bridge still reports. */
export const reportSchema = z.object({
  state: z.enum(["stopped", "starting", "running", "stopping", "error"]).default("stopped"),
  detail: z.string().max(300).nullish(),
  lastCommandId: z.number().int().min(0).default(0),
  speaking: z.string().max(400).nullable().optional(),
  queue: z.array(z.string().max(400)).max(20).default([]),
  recent: z.array(line).max(15).default([]),
  comments: z.array(comment).max(15).default([]),
  parts: z.record(z.string().max(30), z.enum(["ok", "down", "starting", "off"])).optional(),
  voice: z.string().max(60).nullish(),
  muted: z.boolean().optional(),
  chatter: z.boolean().optional(),
  overlay: z.boolean().optional(),
  followers: num,
  tiktok: z.object({ username: z.string().max(30), connected: z.boolean(), viewers: num }).nullable().optional(),
  gpu: z.object({ tempC: num, powerW: num, vramGb: num, utilPct: num }).optional(),
  disk: z.object({ cFreeGb: num, dFreeGb: num }).optional(),
  fps: num,
  uptimeSec: num,
  engine: z.enum(["pro", "lite"]).nullish(),
  litePacks: z.array(z.object({ folder: z.string().max(64), name: z.string().max(80) })).max(40).optional(),
  litePresenter: z.string().max(64).nullish(),
});
export type PraewReport = z.infer<typeof reportSchema> & { receivedAt: string };

/** A small JPEG of the picture, base64; the state bucket holds files up to 64 KB. */
export const snapshotSchema = z.object({ jpeg: z.string().max(60_000).regex(/^[A-Za-z0-9+/=]+$/) });

/** The bridge reports every ~3 s: seen in the last 20 s means the PC is on. */
export const ONLINE_WITHIN_MS = 20_000;
export const isOnline = (report: Pick<PraewReport, "receivedAt"> | null, now = Date.now()) =>
  report !== null && now - Date.parse(report.receivedAt) < ONLINE_WITHIN_MS;
