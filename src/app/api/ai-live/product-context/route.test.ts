import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readLiveSigningConfiguration, verifyLiveEnvelope } from "@/features/ai-live/server-config";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), rateLimit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceOwnerMutationRateLimit: mocks.rateLimit }));
import { POST } from "./route";

const origin = "https://viralflow.example";
const ownerId = "e26ed687-b36b-44d9-a8df-38e9545d760c";
const deviceId = "4b531890-5020-4273-b6fb-2cf6e3cb5f7a";
const accountId = "4d334044-44d6-427b-a44b-872243d58b93";
const productId = "9820f32b-5ff6-4fdc-a5b3-d4b223471b1e";
const keys = generateKeyPairSync("ed25519");
let rows: Record<string, Record<string, unknown>[]>;
let user: { id: string; app_metadata: Record<string, unknown> };

function query(table: string) {
  const filters: ((row: Record<string, unknown>) => boolean)[] = [];
  const result = () => ({ data: rows[table].filter((row) => filters.every((filter) => filter(row))), error: null });
  const chain = {
    select: () => chain,
    eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return chain; },
    is: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return chain; },
    in: (key: string, value: unknown[]) => { filters.push((row) => value.includes(row[key])); return chain; },
    maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
    then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
  };
  return chain;
}
function request(body: unknown = { deviceId, accountId, productIds: [productId] }, sentOrigin = origin) {
  return new Request(origin + "/api/ai-live/product-context", { method: "POST", headers: { origin: sentOrigin, "content-type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AI_LIVE_LEASE_SIGNING_PRIVATE_KEY", keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  user = { id: ownerId, app_metadata: { ai_live: { enabled: true, deviceLimit: 1, expiresAt: new Date(Date.now() + 3600_000).toISOString() } } };
  rows = {
    ai_live_devices: [{ owner_id: ownerId, device_id: deviceId, revoked_at: null }],
    tiktok_accounts: [{ id: accountId, owner_id: ownerId, is_mock: false, hidden_at: null, authorization_status: "authorized" }],
    products: [{ id: productId, owner_id: ownerId, title: "สินค้าของร้าน", status: "available", current_price: 1290,
      currency: "THB", updated_at: "2026-10-06T00:00:00Z", provider_metadata: { debug_token: "never emit", live_commerce: { stock: 7, colors: ["ขาว"], shipping: "สองวัน", debug: "never emit" } } }],
  };
  mocks.getUser.mockImplementation(async () => ({ data: { user }, error: null }));
  mocks.from.mockImplementation(query);
});
afterEach(() => vi.unstubAllEnvs());

describe("trusted local AI product sync", () => {
  it("signs only database facts scoped to the authenticated owner, device and selection", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const signed = await response.json();
    expect(verifyLiveEnvelope(signed, readLiveSigningConfiguration()!)).toBe(true);
    expect(signed.payload).toMatchObject({ ownerId, deviceId, accountId, purpose: "AI_LIVE_PRODUCT_CONTEXT",
      products: [{ productId, facts: { price: 1290, stock: 7, currency: "THB", colors: ["ขาว"] } }] });
    expect(signed.payload.expiresAt - signed.payload.issuedAt).toBeLessThanOrEqual(120);
    expect(JSON.stringify(signed)).not.toMatch(/debug|token|provider_metadata/);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("does not invent stock, promotion or delivery when data is unknown", async () => {
    rows.products[0].provider_metadata = {};
    const signed = await (await POST(request())).json();
    expect(signed.payload.products[0].facts).toEqual({ price: 1290, currency: "THB" });
    rows.products[0].updated_at = "2026-10-06T01:00:00Z";
    expect((await (await POST(request())).json()).payload.products[0].version).toBe("2026-10-06T01:00:00Z");
  });
  it("rejects browser-supplied facts, cross origin, missing Auth, expired membership and revoked devices", async () => {
    expect((await POST(request({ deviceId, accountId, productIds: [productId], facts: { price: 1 } }))).status).toBe(400);
    expect((await POST(request(undefined, "https://other.example"))).status).toBe(403);
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await POST(request())).status).toBe(401);
    user.app_metadata = {};
    expect((await POST(request())).status).toBe(403);
    user.app_metadata = { ai_live: { enabled: true, deviceLimit: 1, expiresAt: "2020-01-01T00:00:00Z" } };
    expect((await POST(request())).status).toBe(403);
  });
  it("refuses revoked devices, other owners' accounts/products and invalid product metadata", async () => {
    rows.ai_live_devices[0].revoked_at = "2026-10-06T00:00:00Z";
    expect((await POST(request())).status).toBe(403);
    rows.ai_live_devices[0].revoked_at = null;
    rows.tiktok_accounts[0].owner_id = deviceId;
    expect((await POST(request())).status).toBe(403);
    rows.tiktok_accounts[0].owner_id = ownerId;
    rows.products[0].owner_id = deviceId;
    expect((await POST(request())).status).toBe(403);
    rows.products[0].owner_id = ownerId;
    rows.products[0].current_price = null;
    expect((await POST(request())).status).toBe(403);
  });
});
