import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
const { parseMediaRightsForm, readRightsProof, recordMediaRights, reviewMediaRights, revokeMediaRights, saveOwnerVoice } = await import("./media-rights-service");
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegBinary } from "./ffmpeg-binary";
const tone = (seconds: number) => { const dir = mkdtempSync(join(tmpdir(), "voice-")), path = join(dir, "v.mp3");
  spawnSync(ffmpegBinary()!, ["-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=200:duration=${seconds}`, "-ac", "1", "-b:a", "64k", path]);
  const bytes = readFileSync(path); rmSync(dir, { recursive: true, force: true }); return new File([bytes], "v.mp3", { type: "audio/mpeg" }); };

const owner = "11111111-1111-4111-8111-111111111111", assetId = "33333333-3333-4333-8333-333333333333";
type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> };
function fakeAdmin(rows: Record<string, unknown[]>, options: { insertError?: { code: string } } = {}) {
  const calls: Call[] = [], uploads: string[] = [], removed: string[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] }; calls.push(call);
      const matches = () => (rows[table] ?? []).filter(r => call.filters.every(([k, v]) => k === "is" || (Array.isArray(v) ? v.includes((r as Record<string, unknown>)[k]) : (r as Record<string, unknown>)[k] === v)));
      const q = {
        select: () => q, eq: (k: string, v: unknown) => (call.filters.push([k, v]), q), in: (k: string, v: unknown[]) => (call.filters.push([k, v]), q),
        is: () => (call.filters.push(["is", null]), q),
        insert: (payload: unknown) => (call.op = "insert", call.payload = payload, q), update: (payload: unknown) => (call.op = "update", call.payload = payload, q),
        maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
        single: async () => call.op === "insert" && options.insertError ? { data: null, error: options.insertError } : { data: { id: "new-rights" }, error: null },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: call.op === "update" ? matches().map(() => ({ id: "x" })) : matches(), error: null }).then(resolve),
      };
      return q;
    },
    storage: { from: () => ({ upload: async (path: string) => (uploads.push(path), { error: null }), remove: async (paths: string[]) => (removed.push(...paths), { error: null }) }) },
  };
  return { admin: client as unknown as SupabaseClient, calls, uploads, removed };
}
const asset = { id: assetId, owner_id: owner, product_id: "44444444-4444-4444-8444-444444444444", storage_path: `owner/${owner}/products/p/clip.mp4` };
function form(extra: Record<string, string | string[]> = {}) {
  const f = new FormData();
  const base: Record<string, string | string[]> = { mediaAssetId: assetId, originSource: "OWNER_CREATED", assetRole: "REAL_FOOTAGE", sourceReference: "ถ่ายเองที่ร้าน",
    rightsholder: "Lucky", licenseType: "ถ่ายเอง", allowsCommercial: "on", allowsEdit: "on", platformScope: ["TIKTOK"], ...extra };
  for (const [k, v] of Object.entries(base)) for (const item of [v].flat()) f.append(k, item);
  return f;
}
const pdf = (bytes = "%PDF-1.7 license") => new File([bytes], "license.pdf", { type: "application/pdf" });

describe("media rights attestation", () => {
  it("parses checkboxes as explicit permissions and requires a platform", () => {
    const input = parseMediaRightsForm(form());
    expect(input).toMatchObject({ allowsCommercial: true, allowsEdit: true, allowsPromotion: false, platformScope: ["TIKTOK"], accountScope: [], expiresAt: null });
    expect(() => parseMediaRightsForm(form({ platformScope: [] }))).toThrow();
  });
  it("accepts only real PDF or image proof within the size limit", async () => {
    expect(await readRightsProof(null)).toBeNull();
    expect((await readRightsProof(pdf()))?.sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(readRightsProof(new File(["not a pdf"], "x.pdf", { type: "application/pdf" }))).rejects.toThrow("rights_proof_invalid");
    await expect(readRightsProof(new File(["%PDF-"], "x.exe", { type: "application/x-msdownload" }))).rejects.toThrow("rights_proof_invalid");
    await expect(readRightsProof(pdf("%PDF-" + "x".repeat(900_001)))).rejects.toThrow("rights_proof_invalid");
  });
  it("records owner-made media as PENDING without proof", async () => {
    const { admin, calls, uploads } = fakeAdmin({ media_assets: [asset] });
    await recordMediaRights(admin, owner, parseMediaRightsForm(form()), null);
    const insert = calls.find(c => c.table === "media_asset_rights" && c.op === "insert")!;
    expect(insert.payload).toMatchObject({ owner_id: owner, media_asset_id: assetId, product_id: asset.product_id, attested_by: owner, proof_sha256: null, account_scope: null });
    expect(insert.payload).not.toHaveProperty("review_state");
    expect(uploads).toEqual([]);
  });
  it("requires proof for third-party media and stores its hash under the owner's path", async () => {
    const { admin, calls, uploads } = fakeAdmin({ media_assets: [asset] });
    await expect(recordMediaRights(admin, owner, parseMediaRightsForm(form({ originSource: "MERCHANT_LICENSED" })), null)).rejects.toThrow("rights_proof_required");
    const proof = await readRightsProof(pdf());
    await recordMediaRights(admin, owner, parseMediaRightsForm(form({ originSource: "MERCHANT_LICENSED" })), proof);
    expect(uploads[0]).toMatch(new RegExp(`^owner/${owner}/products/`));
    expect(calls.find(c => c.op === "insert")?.payload).toMatchObject({ proof_sha256: proof!.sha256, proof_uri: uploads[0] });
  });
  it("refuses another owner's asset, foreign accounts, and cleans up proof when the insert fails", async () => {
    await expect(recordMediaRights(fakeAdmin({ media_assets: [{ ...asset, owner_id: "other" }] }).admin, owner, parseMediaRightsForm(form()), null)).rejects.toThrow("media_asset_not_found");
    await expect(recordMediaRights(fakeAdmin({ media_assets: [{ ...asset, storage_path: "owner/other/x.mp4" }] }).admin, owner, parseMediaRightsForm(form()), null)).rejects.toThrow("media_asset_not_found");
    const account = "55555555-5555-4555-8555-555555555555";
    await expect(recordMediaRights(fakeAdmin({ media_assets: [asset], tiktok_accounts: [] }).admin, owner, parseMediaRightsForm(form({ accountScope: [account] })), null)).rejects.toThrow("account_scope_invalid");
    const failing = fakeAdmin({ media_assets: [asset] }, { insertError: { code: "23505" } });
    await expect(recordMediaRights(failing.admin, owner, parseMediaRightsForm(form({ originSource: "MERCHANT_LICENSED" })), await readRightsProof(pdf()))).rejects.toThrow("media_rights_already_recorded");
    expect(failing.removed).toEqual(failing.uploads);
  });
  it("reviews only pending records and revokes with a reason", async () => {
    const pending = fakeAdmin({ media_asset_rights: [{ id: "r1", owner_id: owner, review_state: "PENDING" }] });
    await reviewMediaRights(pending.admin, owner, "r1", "APPROVED");
    expect(pending.calls[0].payload).toMatchObject({ review_state: "APPROVED", reviewed_by: owner });
    expect(pending.calls[0].filters).toContainEqual(["review_state", "PENDING"]);
    await expect(reviewMediaRights(fakeAdmin({ media_asset_rights: [{ id: "r1", owner_id: owner, review_state: "APPROVED" }] }).admin, owner, "r1", "APPROVED")).rejects.toThrow("media_rights_not_pending");
    await expect(revokeMediaRights(pending.admin, owner, "r1", "")).rejects.toThrow();
    await revokeMediaRights(pending.admin, owner, "r1", "แบรนด์ยกเลิกสิทธิ์");
  });
  it("stores the owner's narration as PENDING owner-created voice for the project", async () => {
    const project = { id: "proj", owner_id: owner, product_id: asset.product_id };
    const { admin, calls, uploads } = fakeAdmin({ creative_projects: [project] });
    await saveOwnerVoice(admin, owner, "proj", tone(4));
    expect(uploads[0]).toMatch(new RegExp(`^owner/${owner}/products/${asset.product_id}/voice-.*\\.mp3$`));
    expect(calls.find(c => c.table === "media_assets" && c.op === "insert")?.payload).toMatchObject({ asset_type: "VOICE", source_type: "UPLOAD", creative_project_id: "proj" });
    const rights = calls.find(c => c.table === "media_asset_rights" && c.op === "insert")?.payload;
    expect(rights).toMatchObject({ origin_source: "OWNER_CREATED", asset_role: "VOICE", attested_by: owner });
    expect(rights).not.toHaveProperty("review_state");
    await expect(saveOwnerVoice(admin, owner, "proj", tone(9))).rejects.toThrow("voice_duration_invalid");
    await expect(saveOwnerVoice(admin, owner, "proj", new File(["x"], "v.exe", { type: "application/octet-stream" }))).rejects.toThrow("voice_invalid");
    await expect(saveOwnerVoice(fakeAdmin({ creative_projects: [] }).admin, owner, "proj", tone(4))).rejects.toThrow("project_not_found");
  }, 60_000);
});
