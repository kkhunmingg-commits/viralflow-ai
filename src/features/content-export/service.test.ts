import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const config = vi.hoisted(() => ({ enabled: true, key: "test-runtime-key", allowedOwners: ["10000000-0000-4000-8000-000000000001"], brainModel: "google/gemini-2.5-flash-lite", dailyCapUsd: 5, monthlyCapUsd: 30 }));
vi.mock("./config", () => ({ contentExportConfig: () => config }));
import { advanceContentRun, contentMedia, listContentRuns, reviewContentRun, startContentRun, stopContentRun } from "./service";
import { ContentProvider } from "./provider";
import type { ContentRequest } from "./contracts";

type Row = Record<string, unknown>;
const owner = "10000000-0000-4000-8000-000000000001", other = "10000000-0000-4000-8000-000000000009", accountId = "10000000-0000-4000-8000-000000000002";
const idea = { title: "จัดโต๊ะให้หยิบของง่าย", hook: "โต๊ะเล็กก็จัดให้น่าใช้ได้", script: "จัดของที่ใช้บ่อยไว้ใกล้มือ ลองเปลี่ยนมุมเล็ก ๆ ดู", caption: "ไอเดียจัดโต๊ะของเรา", hashtags: ["#จัดโต๊ะ"], imagePrompt: "A tidy wooden desk with stationery", videoPrompt: "Slow camera move over a tidy desk", rationale: "เริ่มจากเรื่องใกล้ตัว ชวนคนดูแชร์วิธีของตนเอง" };
// Transport-only MP4 fixture. Not evidence of a real fal output or visual PASS.
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 105, 115, 111, 109, 109, 112, 52, 50]), Buffer.alloc(1100)]);
function database() {
  const rows: Record<string, Row[]> = { tiktok_accounts: [{ id: accountId, owner_id: owner, hidden_at: null, is_mock: false,
    preferred_categories: ["ชีวิตประจำวัน"], ecommerce_permission: false, cart_enabled: false, daily_video_budget_usd: 5, monthly_video_budget_usd: 30 }],
    content_export_runs: [], products: [], media_assets: [], generation_jobs: [], generation_budget_reservations: [] };
  const objects = new Map<string, Blob>();
  function from(table: string) {
    const predicates: Array<(row: Row) => boolean> = [];
    let values: Row | undefined, operation = "select";
    const query = {
      select: () => query, eq: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return query; },
      neq: (key: string, value: unknown) => { predicates.push(row => row[key] !== value); return query; },
      is: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return query; },
      in: (key: string, list: unknown[]) => { predicates.push(row => list.includes(row[key])); return query; },
      order: () => query, limit: () => query,
      insert: (value: Row) => { operation = "insert"; values = value; return query; },
      upsert: (value: Row) => { operation = "upsert"; values = value; return query; },
      update: (value: Row) => { operation = "update"; values = value; return query; },
      single: async () => execute(true), maybeSingle: async () => execute(true),
      then: (resolve: (value: unknown) => void) => Promise.resolve(execute(false)).then(resolve),
    };
    function execute(single: boolean) {
      let matches = rows[table].filter(row => predicates.every(predicate => predicate(row)));
      if (operation === "insert" || operation === "upsert") {
        const prior = rows[table].find(row => values?.idempotency_key && row.idempotency_key === values.idempotency_key && row.owner_id === values.owner_id);
        if (prior) matches = [prior];
        else {
          const row = { id: randomUUID(), status: "QUEUED", reserved_usd: 0, title: "", script: "", caption: "", rationale: "", message: "", lease_token: null, created_at: new Date().toISOString(), ...values };
          rows[table].push(row); matches = [row];
        }
      }
      if (operation === "update") for (const row of matches) Object.assign(row, structuredClone(values));
      return { data: structuredClone(single ? matches[0] ?? null : matches), error: null };
    }
    return query;
  }
  const rpc = vi.fn(async (name: string, input: Row) => {
    if (name === "fal_budget_guard_version") return { data: "fal-generation-budget-guards-v1", error: null };
    if (name === "claim_content_export_run") {
      const row = rows.content_export_runs.find(row => row.id === input.p_run_id && row.owner_id === input.p_owner_id);
      if (!row || row.lease_token || ["CANCELLED", "FAILED", "READY", "REVIEW_REQUIRED"].includes(String(row.status))) return { data: null, error: null };
      row.lease_token = input.p_lease_token; return { data: structuredClone(row), error: null };
    }
    if (name === "reserve_generation_budget") {
      const prior = rows.generation_budget_reservations.find(row => row.logical_operation_key === input.p_logical_operation_key);
      if (prior) return { data: structuredClone(prior), error: null };
      const row = { id: randomUUID(), owner_id: input.p_owner_id, tiktok_account_id: input.p_tiktok_account_id, logical_operation_key: input.p_logical_operation_key,
        state: "RESERVED", provider_submission_state: "REQUEST_NOT_SENT", provider_request_id: null, reserved_usd: input.p_reserved_usd };
      rows.generation_budget_reservations.push(row); return { data: structuredClone(row), error: null };
    }
    const row = rows.generation_budget_reservations.find(row => row.id === input.p_reservation_id);
    if (!row) return { data: null, error: { message: "missing hold" } };
    if (name === "begin_generation_submission") {
      if (row.provider_submission_state !== "REQUEST_NOT_SENT") return { data: null, error: { message: "already submitted" } };
      row.provider_submission_state = "SUBMITTING";
    }
    if (name === "mark_generation_submitted") { row.provider_submission_state = "SUBMITTED"; row.provider_request_id = input.p_provider_request_id; }
    if (name === "mark_generation_unknown") row.provider_submission_state = "SUBMITTED_UNKNOWN";
    if (name === "settle_generation_budget") { row.state = "SETTLED"; row.actual_usd = input.p_actual_usd; }
    return { data: structuredClone(row), error: null };
  });
  const client = { from, rpc, storage: { from: () => ({
    upload: async (path: string, bytes: Uint8Array) => { objects.set(path, new Blob([new Uint8Array(bytes)], { type: "video/mp4" })); return { error: null }; },
    download: async (path: string) => ({ data: objects.get(path), error: null }),
    createSignedUrl: async () => ({ data: { signedUrl: "https://project.supabase.co/storage/product.jpg" }, error: null }),
  }) } } as unknown as SupabaseClient;
  return { client, rows, objects, rpc };
}
function runtime() {
  const provider = new ContentProvider("test");
  provider.quote = vi.fn(async step => step);
  provider.submit = vi.fn(async () => ({ request_id: randomUUID() }));
  provider.read = vi.fn(async step => step.endpoint === "openrouter/router" ? { output: JSON.stringify(idea), usage: { cost: .001 } }
    : step.endpoint.includes("flux") ? { images: [{ url: "https://fal.media/image.jpg" }], has_nsfw_concepts: [false] }
      : step.endpoint.includes("speech") ? { audio: { url: "https://fal.media/voice.mp3" }, duration_ms: 6500 }
        : { video: { url: "https://fal.media/video.mp4" } });
  provider.download = vi.fn(async () => ({ bytes: mp4, mime: "video/mp4" }));
  const compose = vi.fn(async (_source: string, output: string) => {
    await writeFile(output, mp4);
    return { source: {}, media: { hasAudio: true, videoCodec: "h264", audioCodec: "aac", width: 720, height: 1280 } };
  }) as unknown as typeof import("@/features/video/media-composition").composeGeneratedVideo;
  return { provider, compose, validateVoice: vi.fn(async () => undefined) };
}
const request = (): ContentRequest => ({ requestKey: randomUUID(), accountId, mode: "GROWTH", topic: "", budgetUsd: .5, consent: true });
describe("automatic creation to reviewed manual export", () => {
  beforeEach(() => { config.enabled = true; });
  it("Home reads only the selected owner's account and returns customer fields", async () => {
    const db = database(), run = await startContentRun(db.client, owner, request());
    db.rows.content_export_runs.push({ ...db.rows.content_export_runs[0], id: randomUUID(), tiktok_account_id: randomUUID() });
    db.rows.content_export_runs.push({ ...db.rows.content_export_runs[0], id: randomUUID(), owner_id: other });
    const selected = await listContentRuns(db.client, owner, accountId);
    expect(selected).toHaveLength(1); expect(selected[0].id).toBe(run.id);
    expect(selected[0]).not.toHaveProperty("checkpoint"); expect(selected[0]).not.toHaveProperty("lease_token");
  });
  it.each(["GROWTH", "AUTO", "AFFILIATE"] as const)("runs %s from creative thought through review and ZIP without TikTok", async mode => {
    const db = database(), external = runtime(), input = request();
    input.mode = mode;
    if (mode === "AFFILIATE") {
      input.productId = "10000000-0000-4000-8000-000000000003";
      db.rows.products.push({ id: input.productId, owner_id: owner, title: "แฟ้มเอกสาร", status: "available", category_key: "office" });
      db.rows.media_assets.push({ owner_id: owner, product_id: input.productId, asset_type: "PRODUCT_IMAGE", source_type: "UPLOAD", mime_type: "image/jpeg", storage_path: `owner/${owner}/products/reference.jpg`, created_at: new Date().toISOString() });
    }
    let run = await startContentRun(db.client, owner, input);
    expect((await startContentRun(db.client, owner, input)).id).toBe(run.id);
    for (let step = 0; step < (mode === "AFFILIATE" ? 7 : 9); step++) run = await advanceContentRun(db.client, owner, run.id, external);
    expect(run.status).toBe("REVIEW_REQUIRED"); expect(run.script).toBe(idea.script);
    const submissions = mode === "AFFILIATE" ? 3 : 4;
    expect(external.provider.submit).toHaveBeenCalledTimes(submissions); expect(external.compose).toHaveBeenCalledOnce();
    await expect(contentMedia(db.client, owner, run.id, true)).rejects.toThrow("review_required");
    await reviewContentRun(db.client, owner, run.id);
    const zip = await contentMedia(db.client, owner, run.id, true);
    expect(Buffer.from(zip).readUInt32LE(0)).toBe(0x04034b50); expect(Buffer.from(zip).toString()).toContain("NOT_VERIFIED");
    await advanceContentRun(db.client, owner, run.id, external); expect(external.provider.submit).toHaveBeenCalledTimes(submissions);
    expect(db.rows.products).toHaveLength(mode === "AFFILIATE" ? 1 : 0); expect(db.rows.generation_budget_reservations.every(row => row.state === "SETTLED")).toBe(true);
  });
  it("resumes a pending provider request without buying a duplicate", async () => {
    const db = database(), external = runtime(); const run = await startContentRun(db.client, owner, request());
    await advanceContentRun(db.client, owner, run.id, external);
    const requestId = ((db.rows.content_export_runs[0].checkpoint as { steps: { IDEA: { requestId: string } } }).steps.IDEA).requestId;
    external.provider.read = vi.fn(async () => null);
    for (let index = 0; index < 3; index++) await advanceContentRun(db.client, owner, run.id, external);
    expect(external.provider.submit).toHaveBeenCalledOnce(); expect(external.provider.read).toHaveBeenLastCalledWith(expect.anything(), requestId);
  });
  it("rejects cross-user access and stops only the chosen run", async () => {
    const db = database(), external = runtime(), run = await startContentRun(db.client, owner, request());
    await expect(advanceContentRun(db.client, other, run.id, external)).rejects.toThrow("not_configured");
    await expect(contentMedia(db.client, other, run.id, true)).rejects.toThrow("missing");
    await stopContentRun(db.client, owner, run.id);
    expect((await advanceContentRun(db.client, owner, run.id, external)).status).toBe("CANCELLED");
    expect(external.provider.submit).not.toHaveBeenCalled();
  });
  it("a lost submit response blocks another paid attempt and another start", async () => {
    const db = database(), external = runtime(), run = await startContentRun(db.client, owner, request());
    external.provider.submit = vi.fn(async () => { throw new Error("network failure after submit"); });
    expect((await advanceContentRun(db.client, owner, run.id, external)).status).toBe("FAILED");
    await advanceContentRun(db.client, owner, run.id, external);
    await expect(startContentRun(db.client, owner, request())).rejects.toThrow("uncertain");
    expect(external.provider.submit).toHaveBeenCalledOnce();
  });
  it("does not allow unaudited text claims to purchase images or footage", async () => {
    const db = database(), external = runtime(), run = await startContentRun(db.client, owner, request());
    external.provider.read = vi.fn(async () => ({ output: JSON.stringify({ ...idea, script: "รักษาโรคให้หายขาด" }) }));
    await advanceContentRun(db.client, owner, run.id, external);
    expect((await advanceContentRun(db.client, owner, run.id, external)).status).toBe("FAILED");
    expect(external.provider.submit).toHaveBeenCalledOnce();
  });
  it("the kill switch blocks new and resumed paid work", async () => {
    const db = database(), external = runtime(), run = await startContentRun(db.client, owner, request()); config.enabled = false;
    await expect(startContentRun(db.client, owner, request())).rejects.toThrow("not_configured");
    await expect(advanceContentRun(db.client, owner, run.id, external)).rejects.toThrow("not_configured");
    expect(external.provider.submit).not.toHaveBeenCalled();
  });
  it("rejects a quote above the clip cap before making a paid submission", async () => {
    const db = database(), external = runtime(), run = await startContentRun(db.client, owner, request());
    external.provider.quote = vi.fn(async step => ({ ...step, reserveUsd: .6 }));
    expect((await advanceContentRun(db.client, owner, run.id, external)).status).toBe("FAILED");
    expect(external.provider.submit).not.toHaveBeenCalled();
    expect(db.rows.generation_budget_reservations).toHaveLength(0);
  });
  it("concurrent advances claim one session and buy one provider request", async () => {
    const db = database(), external = runtime(), run = await startContentRun(db.client, owner, request());
    await Promise.all([advanceContentRun(db.client, owner, run.id, external), advanceContentRun(db.client, owner, run.id, external)]);
    expect(external.provider.submit).toHaveBeenCalledOnce();
  });
  it("invalid narration blocks the footage purchase", async () => {
    const db = database(), external = runtime(), run = await startContentRun(db.client, owner, request());
    external.validateVoice = vi.fn(async () => { throw new Error("video_voice_unavailable"); });
    let result = run;
    for (let i = 0; i < 6; i++) result = await advanceContentRun(db.client, owner, run.id, external);
    expect(result.status).toBe("FAILED");
    expect(external.provider.submit).toHaveBeenCalledTimes(3);
  });
});
