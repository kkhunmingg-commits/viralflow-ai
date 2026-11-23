import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readStateFile, saveStateFile } from "@/features/flow-farm/service";
import {
  applyAction, BACKGROUNDS, emptyStudio, resolveBackground, presenterSchema, studioReportSchema,
  type BackgroundId, type Presenter, type StudioAction, type StudioDesired, type StudioReport,
} from "./contract";

/** Photos, candidate faces, face pictures and voice samples: private, shown through short signed links. */
const ASSET_BUCKET = "video-assets";
const base = (owner: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(owner)) throw new Error("INVALID_OWNER");
  return `owner/${owner}/presenter-studio`;
};
const newId = () => "p" + Array.from(randomBytes(8), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

export async function readStudio(admin: SupabaseClient, owner: string): Promise<StudioDesired> {
  const raw = await readStateFile<StudioDesired>(admin, `${base(owner)}/desired.json`);
  if (!raw) return emptyStudio();
  // A presenter that no longer parses (older shape) is dropped rather than breaking the whole page.
  const presenters = (Array.isArray(raw.presenters) ? raw.presenters : [])
    .map(p => presenterSchema.safeParse(p)).filter(r => r.success).map(r => r.data as Presenter);
  return { presenters, active: typeof raw.active === "string" ? raw.active : "praew", updatedAt: raw.updatedAt ?? null };
}
const saveStudio = (admin: SupabaseClient, owner: string, d: StudioDesired) =>
  saveStateFile(admin, `${base(owner)}/desired.json`, d, "presenter_studio_not_saved");

export async function readStudioReport(admin: SupabaseClient, owner: string): Promise<StudioReport | null> {
  const raw = await readStateFile<StudioReport>(admin, `${base(owner)}/report.json`);
  if (!raw) return null;
  const parsed = studioReportSchema.safeParse(raw);
  return parsed.success ? { ...parsed.data, receivedAt: String(raw.receivedAt ?? "") } : null;
}
export async function saveStudioReport(admin: SupabaseClient, owner: string, report: unknown) {
  const parsed = studioReportSchema.parse(report);
  await saveStateFile(admin, `${base(owner)}/report.json`, { ...parsed, receivedAt: new Date().toISOString() }, "presenter_report_not_saved");
}

export async function changeStudio(admin: SupabaseClient, owner: string, action: Exclude<StudioAction, { action: "uploadUrl" }>, now = new Date()) {
  const before = await readStudio(admin, owner);
  const next = applyAction(before, action, owner, now, newId);
  await saveStudio(admin, owner, next);
  if (action.action === "delete") {
    const gone = before.presenters.find(p => p.id === action.id);
    await removePresenterFiles(admin, owner, action.id, [gone?.source.kind === "photo" ? gone.source.path : null, gone?.bgPath ?? null]).catch(() => {});
  }
  if (action.action === "update" && action.background !== undefined) {   // a replaced shop photo is not needed any more
    const was = before.presenters.find(p => p.id === action.id)?.bgPath;
    const now = next.presenters.find(p => p.id === action.id)?.bgPath;
    if (was && was !== now) await admin.storage.from(ASSET_BUCKET).remove([was]).catch(() => {});
  }
  return next;
}

/** A signed upload address for the owner's photo (the browser uploads it straight to Storage). */
export async function photoUploadUrl(admin: SupabaseClient, owner: string, type: "image/jpeg" | "image/png") {
  const path = `${base(owner)}/uploads/${randomBytes(9).toString("base64url").replace(/[^A-Za-z0-9]/g, "x")}.${type === "image/png" ? "png" : "jpg"}`;
  const signed = await admin.storage.from(ASSET_BUCKET).createSignedUploadUrl(path);
  if (signed.error || !signed.data) throw new Error("UPLOAD_URL_UNAVAILABLE");
  return { path, token: signed.data.token };
}

/** Files the PC uploads for one presenter: face.jpg, face_0..3.jpg (candidates), voice.mp3. */
export const PC_FILES = ["face.jpg", "face_0.jpg", "face_1.jpg", "face_2.jpg", "face_3.jpg", "voice.mp3"] as const;
export type PcFile = typeof PC_FILES[number];
export const presenterFile = (owner: string, id: string, file: PcFile) => `${base(owner)}/${id}/${file}`;

export async function signedFile(admin: SupabaseClient, path: string, seconds = 3600) {
  const signed = await admin.storage.from(ASSET_BUCKET).createSignedUrl(path, seconds);
  return signed.error ? null : signed.data.signedUrl;
}
/** One signed upload address per file the PC wants to send (upsert: a rebuild replaces the old face). */
export async function pcUploadUrl(admin: SupabaseClient, owner: string, id: string, file: PcFile) {
  const signed = await admin.storage.from(ASSET_BUCKET).createSignedUploadUrl(presenterFile(owner, id, file), { upsert: true });
  if (signed.error || !signed.data) throw new Error("UPLOAD_URL_UNAVAILABLE");
  return signed.data.signedUrl;
}
async function removePresenterFiles(admin: SupabaseClient, owner: string, id: string, uploads: (string | null)[]) {
  await admin.storage.from(ASSET_BUCKET).remove([...PC_FILES.map(f => presenterFile(owner, id, f)), ...uploads.filter((x): x is string => !!x)]);
}

/** Previews of the shop sets the PC has made (one small JPEG each, shared by all the owner's presenters). */
export const BG_FILE = /^bg_([a-z]{2,20})\.jpg$/;
export const isBackgroundFile = (file: string) => { const m = BG_FILE.exec(file); return !!m && BACKGROUNDS.some(b => b.id === m[1]); };
const libraryFile = (owner: string, file: string) => `${base(owner)}/library/${file}`;
export async function pcLibraryUploadUrl(admin: SupabaseClient, owner: string, file: string) {
  if (!isBackgroundFile(file)) throw new Error("INVALID_FILE");
  const signed = await admin.storage.from(ASSET_BUCKET).createSignedUploadUrl(libraryFile(owner, file), { upsert: true });
  if (signed.error || !signed.data) throw new Error("UPLOAD_URL_UNAVAILABLE");
  return signed.data.signedUrl;
}
async function backgroundPreviews(admin: SupabaseClient, owner: string, ids: BackgroundId[]) {
  const links = await Promise.all(ids.map(async id => [id, await signedFile(admin, libraryFile(owner, `bg_${id}.jpg`))] as const));
  return Object.fromEntries(links.filter(([, url]) => url)) as Partial<Record<BackgroundId, string>>;
}

/** Everything the page shows: the owner's presenters with their PC progress and signed picture links. */
export async function studioView(admin: SupabaseClient, owner: string) {
  const [desired, report] = await Promise.all([readStudio(admin, owner), readStudioReport(admin, owner)]);
  const presenters = await Promise.all(desired.presenters.map(async p => {
    const job = report?.jobs[p.id];
    const current = job && job.rev >= p.rev ? job : undefined;
    const [photo, face, voice, candidates, shop] = await Promise.all([
      p.source.kind === "photo" ? signedFile(admin, p.source.path) : Promise.resolve(null),
      current?.face ? signedFile(admin, presenterFile(owner, p.id, "face.jpg")) : Promise.resolve(null),
      current?.voiceSample ? signedFile(admin, presenterFile(owner, p.id, "voice.mp3")) : Promise.resolve(null),
      current?.faces ? Promise.all(Array.from({ length: current.faces }, (_, i) => signedFile(admin, presenterFile(owner, p.id, `face_${i}.jpg` as PcFile)))) : Promise.resolve([]),
      p.bgPath ? signedFile(admin, p.bgPath) : Promise.resolve(null),
    ]);
    return { ...p, job: current ?? null, pictures: { photo, face, voice, candidates, shop } };
  }));
  const backgrounds = await backgroundPreviews(admin, owner, report?.backgrounds ?? []);
  return { presenters, active: desired.active, report, backgrounds };
}
export type StudioView = Awaited<ReturnType<typeof studioView>>;

/** What the PC worker gets: every presenter with a link to its photo (or chosen face) to build from. */
export async function workerJobs(admin: SupabaseClient, owner: string) {
  const desired = await readStudio(admin, owner);
  const presenters = await Promise.all(desired.presenters.map(async p => ({
    ...p, photoUrl: p.source.kind === "photo" ? await signedFile(admin, p.source.path, 1800) : null,
    // resolved for the PC: a set id, or "custom" with a link to the owner's shop photo (auto = by gender)
    background: resolveBackground(p),
    backgroundUrl: p.background === "custom" && p.bgPath ? await signedFile(admin, p.bgPath, 1800) : null,
  })));
  return { presenters, active: desired.active, updatedAt: desired.updatedAt };
}
