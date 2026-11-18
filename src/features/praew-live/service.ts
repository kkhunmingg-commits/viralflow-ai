import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readStateFile, saveStateFile } from "@/features/flow-farm/service";
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
