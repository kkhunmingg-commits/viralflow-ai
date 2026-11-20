import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rateLimit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceOwnerMutationRateLimit: mocks.rateLimit }));
import { GET } from "./route";
import { RequestSecurityError } from "@/lib/security/request";
import { readLiveSigningConfiguration, verifyLiveEnvelope } from "@/features/ai-live/server-config";
import { LIVE_COMPONENT_VERSIONS } from "@/features/ai-live/local-contract";

const keys = generateKeyPairSync("ed25519");
const owner = "e26ed687-b36b-44d9-a8df-38e9545d760c";
const url = "https://viralflow.example/api/ai-live/updates/manifest";
const versions = { web: LIVE_COMPONENT_VERSIONS.web, agent: LIVE_COMPONENT_VERSIONS.agent, worker: LIVE_COMPONENT_VERSIONS.worker };
const release = { versions, minimumVersions: versions, mandatory: false,
  rollbackVersion: null, package: { sha256: "a".repeat(64), sizeBytes: 1000 } };
let user: { id: string; app_metadata: Record<string, unknown>; user_metadata?: Record<string, unknown> };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AI_LIVE_LEASE_SIGNING_PRIVATE_KEY", keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  vi.stubEnv("AI_LIVE_SIGNING_KEY_ID", "release-2026");
  vi.stubEnv("AI_LIVE_SIGNING_PUBLIC_KEYS_JSON", JSON.stringify({ "release-2026": keys.publicKey.export({ type: "spki", format: "pem" }).toString() }));
  vi.stubEnv("AI_LIVE_UPDATE_ORIGIN", "https://downloads.viralflow.example");
  vi.stubEnv("AI_LIVE_UPDATE_RELEASE_JSON", JSON.stringify(release));
  user = { id: owner, app_metadata: { ai_live: { enabled: true, deviceLimit: 1, expiresAt: new Date(Date.now() + 300_000).toISOString() } } };
  mocks.getUser.mockImplementation(async () => ({ data: { user }, error: null }));
  mocks.rateLimit.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/ai-live/updates/manifest", () => {
  it("returns only a signed no-cache release through authenticated, rate-limited server path", async () => {
    const result = await GET(new Request(url));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    const manifest = await result.json();
    expect(verifyLiveEnvelope(manifest, readLiveSigningConfiguration()!)).toBe(true);
    expect(manifest).toMatchObject({ keyId: "release-2026", payload: { v: 2, versions: release.versions } });
    expect(JSON.stringify(manifest)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(manifest)).not.toContain(owner);
    expect(mocks.rateLimit).toHaveBeenCalledWith("ai-live-update-manifest", owner);
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
  });

  it("rejects anonymous and expired/inactive membership, ignoring user-editable metadata", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await GET(new Request(url))).status).toBe(401);
    mocks.getUser.mockImplementation(async () => ({ data: { user }, error: null }));
    user.user_metadata = { ai_live: user.app_metadata.ai_live }; user.app_metadata = {};
    expect((await GET(new Request(url))).status).toBe(403);
    user.app_metadata = { ai_live: { enabled: false, deviceLimit: 1, expiresAt: new Date(Date.now() + 300_000).toISOString() } };
    expect((await GET(new Request(url))).status).toBe(403);
    user.app_metadata = { ai_live: { enabled: true, deviceLimit: 1, expiresAt: new Date(Date.now() - 1000).toISOString() } };
    expect((await GET(new Request(url))).status).toBe(403);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });

  it("fails honestly on missing signer/storage, rate limiting, network failure without raw errors", async () => {
    vi.stubEnv("AI_LIVE_SIGNING_KEY_ID", "");
    expect((await GET(new Request(url))).status).toBe(503);
    vi.stubEnv("AI_LIVE_SIGNING_KEY_ID", "release-2026");
    vi.stubEnv("AI_LIVE_UPDATE_ORIGIN", "");
    expect((await GET(new Request(url))).status).toBe(503);
    vi.stubEnv("AI_LIVE_UPDATE_ORIGIN", "https://downloads.viralflow.example");
    mocks.rateLimit.mockRejectedValue(new RequestSecurityError("rate_limited", 429));
    expect((await GET(new Request(url))).status).toBe(429);
    mocks.rateLimit.mockRejectedValue(new Error("private database and token diagnostics"));
    const failed = await GET(new Request(url));
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private database");
  });

  it("rejects cross-origin reads before auth and does not accept a request-supplied release URL", async () => {
    expect((await GET(new Request(url, { headers: { origin: "https://evil.example" } }))).status).toBe(403);
    expect((await GET(new Request(url, { headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
    const result = await GET(new Request(url + "?url=https://evil.example/package.zip"));
    expect(result.status).toBe(200);
    expect((await result.json()).payload.package.url).toBe(`https://downloads.viralflow.example/viralflow/ai-live/releases/${versions.agent}/package.zip`);
  });
});
