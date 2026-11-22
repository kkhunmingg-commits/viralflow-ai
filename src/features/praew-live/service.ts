import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readStateFile, saveStateFile } from "@/features/flow-farm/service";
import { praewFeed } from "@/features/ai-live/lineup-service";
import type { PraewProduct } from "@/features/ai-live/live-director";
import { signedAsset } from "@/features/live-overlay/service";
import { emptyDesired, enqueue, type PraewCommand, type PraewDesired, type PraewReport } from "./contract";

const base = (owner: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(owner)) throw new Error("INVALID_OWNER");
  return `owner/${owner}/praew-live`;
};
export const readDesired = async (admin: SupabaseClient, owner: string) =>
  await readStateFile<PraewDesired>(admin, `${base(owner)}/desired.json`) ?? emptyDesired();
export async function pushCommand(admin: SupabaseClient, owner: string, command: PraewCommand) {
  const next = enqueue(await readDesired(admin, owner), command);
  await saveStateFile(admin, `${base(owner)}/desired.json`, next, "praew_command_not_saved");
  return next;
}
export const readReport = (admin: SupabaseClient, owner: string) => readStateFile<PraewReport>(admin, `${base(owner)}/report.json`);
export const saveReport = (admin: SupabaseClient, owner: string, report: PraewReport) =>
  saveStateFile(admin, `${base(owner)}/report.json`, report, "praew_report_not_saved");
export const readSnapshot = (admin: SupabaseClient, owner: string) =>
  readStateFile<{ jpeg: string; at: string }>(admin, `${base(owner)}/snapshot.json`);
export const saveSnapshot = (admin: SupabaseClient, owner: string, jpeg: string) =>
  saveStateFile(admin, `${base(owner)}/snapshot.json`, { jpeg, at: new Date().toISOString() }, "praew_snapshot_not_saved");

/** The bridge polls every few seconds; the product feed (sales + posted clips) is worked out at most once a minute. */
const FEED_TTL_MS = 60_000;
export async function productFeed(admin: SupabaseClient, owner: string, now = new Date()): Promise<PraewProduct[]> {
  const path = `${base(owner)}/products.json`;
  const cached = await readStateFile<{ at: string; products: PraewProduct[] }>(admin, path);
  if (cached && now.getTime() - Date.parse(cached.at) < FEED_TTL_MS) return cached.products;
  try {
    // Storage photos (link clips) go out as 6-hour signed links so the PC's product card can show them.
    const products = await Promise.all((await praewFeed(admin, owner, now)).map(async p => {
      if (!p.image || p.image.startsWith("https://")) return p;
      const url = await signedAsset(admin, owner, p.image).catch(() => null);
      const { image: _drop, ...rest } = p; void _drop;
      return url ? { ...p, image: url } : rest;
    }));
    await saveStateFile(admin, path, { at: now.toISOString(), products }, "praew_products_not_saved").catch(() => {});
    return products;
  } catch {
    // A failed query keeps what Praew already has rather than emptying her product list.
    return cached?.products ?? [];
  }
}
