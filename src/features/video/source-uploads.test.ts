import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownsVideoStoragePath } from "./storage";
import { VIDEO_BUCKET } from "./types";
import { uploadVideoFactorySource, VIDEO_SOURCE_UPLOAD_MAX_BYTES } from "./source-uploads";

vi.mock("server-only", () => ({}));
type Row = Record<string, unknown>;
const owner = "11111111-1111-4111-8111-111111111111", anotherOwner = "22222222-2222-4222-8222-222222222222";
let dir: string, photo: Uint8Array, narration: Uint8Array;

async function fixture(args: string[]) {
  const binary = join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args], { windowsHide: true });
    child.on("error", reject); child.on("close", code => code === 0 ? resolve() : reject(new Error("upload_fixture_failed")));
  });
}

function database() {
  const tables: Record<string, Row[]> = {
    master_videos: [{ id: "master", owner_id: owner, creative_project_id: "project", product_id: "product", tiktok_account_id: "account" }],
    creative_projects: [{ id: "project", owner_id: owner, product_id: "product", tiktok_account_id: "account" }],
    products: [{ id: "product", owner_id: owner }], tiktok_accounts: [{ id: "account", owner_id: owner }], media_assets: [],
  };
  const files = new Map<string, Uint8Array>();
  let assetError = false;
  class Query {
    private filters: Array<(row: Row) => boolean> = [];
    constructor(private table: string) {}
    select() { return this; }
    eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this; }
    async maybeSingle() { return { data: tables[this.table].find(row => this.filters.every(filter => filter(row))) ?? null, error: null }; }
    async upsert(asset: Row) {
      if (assetError) return { data: null, error: { message: "database unavailable" } };
      tables[this.table].push(asset); return { data: null, error: null };
    }
  }
  const upload = vi.fn(async (path: string, bytes: Uint8Array, options: { contentType: string; upsert: boolean }) => {
    if (files.has(path) && !options.upsert) return { error: { message: "file already exists" } };
    files.set(path, new Uint8Array(bytes)); return { error: null };
  });
  const remove = vi.fn(async (paths: string[]) => { for (const path of paths) files.delete(path); return { error: null }; });
  const fromBucket = vi.fn(() => ({ upload, remove }));
  const network = vi.fn(() => { throw new Error("uploads_must_not_generate_paid_media"); });
  vi.stubGlobal("fetch", network);
  const client = { from: (table: string) => new Query(table), storage: { from: fromBucket } } as unknown as SupabaseClient;
  return { client, tables, files, upload, remove, fromBucket, network, failAssetWrite: () => { assetError = true; } };
}
const imageFile = (type = "image/jpeg") => new File([new Uint8Array(photo)], "../../unsafe-name.jpg", { type });
const voiceFile = () => new File([new Uint8Array(narration)], "../../unsafe-name.wav", { type: "audio/wav" });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "viralflow-source-upload-test-"));
  await fixture(["-f", "lavfi", "-i", "color=c=blue:s=160x160", "-frames:v", "1", join(dir, "photo.jpg")]);
  await fixture(["-f", "lavfi", "-i", "sine=frequency=330:sample_rate=16000:duration=2", join(dir, "voice.wav")]);
  [photo, narration] = await Promise.all([readFile(join(dir, "photo.jpg")), readFile(join(dir, "voice.wav"))]);
}, 30_000);
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("real Video Factory source uploads", () => {
  it("stores the exact original photo and narration in private owner paths without generating substitute media", async () => {
    const db = database();
    for (const [kind, file] of [["PRODUCT_IMAGE", imageFile()], ["VOICE", voiceFile()]] as const) {
      const saved = await uploadVideoFactorySource(db.client, owner, "master", kind, file);
      const original = new Uint8Array(await file.arrayBuffer()), stored = db.files.get(saved.storagePath)!;
      expect(Buffer.from(stored).equals(Buffer.from(original))).toBe(true);
      expect(ownsVideoStoragePath(owner, saved.storagePath)).toBe(true);
      expect(saved.storagePath).toMatch(new RegExp(`^owner/${owner}/${kind === "PRODUCT_IMAGE" ? "products/product" : "masters/master"}/source-[a-f0-9-]+\\.${kind === "PRODUCT_IMAGE" ? "jpg" : "wav"}$`));
      expect(db.tables.media_assets.at(-1)).toMatchObject({ owner_id: owner, product_id: "product", creative_project_id: "project",
        asset_type: kind, source_type: "UPLOAD", provider: "upload", checksum: createHash("sha256").update(original).digest("hex") });
      expect(db.upload.mock.calls.at(-1)?.[2]).toMatchObject({ contentType: file.type, upsert: false });
    }
    expect(db.fromBucket).toHaveBeenCalledWith(VIDEO_BUCKET); expect(db.network).not.toHaveBeenCalled();
  });

  it("denies another owner's master, project, product or account before any upload", async () => {
    for (const table of ["master_videos", "creative_projects", "products", "tiktok_accounts"]) {
      const db = database(); db.tables[table][0].owner_id = anotherOwner;
      await expect(uploadVideoFactorySource(db.client, owner, "master", "PRODUCT_IMAGE", imageFile())).rejects.toThrow("video_source_not_found");
      expect(db.upload).not.toHaveBeenCalled(); expect(db.tables.media_assets).toHaveLength(0);
    }
  });

  it("rejects mismatched project identity even when all records belong to the same owner", async () => {
    const db = database(); db.tables.creative_projects[0].product_id = "different-product";
    await expect(uploadVideoFactorySource(db.client, owner, "master", "VOICE", voiceFile())).rejects.toThrow("video_source_identity_invalid");
    expect(db.upload).not.toHaveBeenCalled();
  });

  it("rejects unsupported MIME, prototype property MIME, empty and oversized files before storing them", async () => {
    const db = database();
    for (const file of [imageFile("image/svg+xml"), imageFile("constructor")]) {
      await expect(uploadVideoFactorySource(db.client, owner, "master", "PRODUCT_IMAGE", file)).rejects.toThrow("video_source_type_invalid");
    }
    for (const bytes of [new Uint8Array(), new Uint8Array(VIDEO_SOURCE_UPLOAD_MAX_BYTES + 1)]) {
      await expect(uploadVideoFactorySource(db.client, owner, "master", "VOICE", new File([bytes], "voice.wav", { type: "audio/wav" })))
        .rejects.toThrow("video_source_size_invalid");
    }
    await expect(uploadVideoFactorySource(db.client, owner, "master", "VOICE", imageFile())).rejects.toThrow("video_source_type_invalid");
    expect(db.upload).not.toHaveBeenCalled();
  });

  it("runs actual media validation and rejects corrupt photo or audio bytes without any upload", async () => {
    const db = database();
    await expect(uploadVideoFactorySource(db.client, owner, "master", "PRODUCT_IMAGE", new File(["not an image"], "photo.jpg", { type: "image/jpeg" })))
      .rejects.toThrow("video_source_file_invalid");
    await expect(uploadVideoFactorySource(db.client, owner, "master", "VOICE", new File(["not audio"], "voice.wav", { type: "audio/wav" })))
      .rejects.toThrow("video_source_file_invalid");
    await expect(uploadVideoFactorySource(db.client, owner, "master", "VOICE", new File([new Uint8Array(photo)], "voice.wav", { type: "audio/wav" })))
      .rejects.toThrow("video_source_file_invalid");
    await expect(uploadVideoFactorySource(db.client, owner, "master", "PRODUCT_IMAGE", new File([new Uint8Array([0xff, 0xd8, 0xff]), "broken JPEG"], "photo.jpg", { type: "image/jpeg" })))
      .rejects.toThrow("video_source_file_invalid");
    await expect(uploadVideoFactorySource(db.client, owner, "master", "VOICE", new File(["RIFF0000WAVEbroken WAV"], "voice.wav", { type: "audio/wav" })))
      .rejects.toThrow("video_source_file_invalid");
    await expect(uploadVideoFactorySource(db.client, owner, "master", "PRODUCT_IMAGE", new File(["#EXTM3U\nhttps://example.invalid/source.ts"], "photo.jpg", { type: "image/jpeg" })))
      .rejects.toThrow("video_source_file_invalid");
    expect(db.upload).not.toHaveBeenCalled(); expect(db.network).not.toHaveBeenCalled();
  });

  it("removes its newly uploaded file if metadata storage fails", async () => {
    const db = database(); db.failAssetWrite();
    await expect(uploadVideoFactorySource(db.client, owner, "master", "VOICE", voiceFile())).rejects.toThrow("video_source_asset_write_failed");
    const path = db.upload.mock.calls[0][0];
    expect(db.remove).toHaveBeenCalledWith([path]); expect(db.files.size).toBe(0); expect(db.tables.media_assets).toHaveLength(0);
  });
});
