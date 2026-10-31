import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rateLimit: vi.fn(),
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/features/tiktok/services", () => ({ TikTokCreatorService: class {}, TikTokTokenService: class {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceOwnerMutationRateLimit: mocks.rateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { hideDisconnectedTikTokAccount } from "./tiktok-actions";

const accountId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";

function adminQuery() {
  const query = {
    update: vi.fn(), eq: vi.fn(), in: vi.fn(), is: vi.fn(), select: vi.fn(), maybeSingle: vi.fn(),
  };
  query.update.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.select.mockReturnValue(query);
  mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => query) });
  return query;
}

describe("hide disconnected TikTok account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: ownerId } }, error: null });
    mocks.rateLimit.mockResolvedValue(undefined);
  });

  it("hides only an owned, real, disconnected account and refreshes account views", async () => {
    const query = adminQuery();
    query.maybeSingle.mockResolvedValue({ data: { id: accountId }, error: null });

    expect(await hideDisconnectedTikTokAccount(accountId, { error: null })).toEqual({ error: null });
    expect(mocks.rateLimit).toHaveBeenCalledWith("tiktok-account", ownerId);
    expect(query.eq).toHaveBeenCalledWith("owner_id", ownerId);
    expect(query.eq).toHaveBeenCalledWith("id", accountId);
    expect(query.eq).toHaveBeenCalledWith("provider", "tiktok");
    expect(query.eq).toHaveBeenCalledWith("is_mock", false);
    expect(query.eq).toHaveBeenCalledWith("connection_status", "DISCONNECTED");
    expect(query.in).toHaveBeenCalledWith("authorization_status", ["revoked", "disconnected"]);
    expect(query.is).toHaveBeenCalledWith("hidden_at", null);
    expect(Number.isNaN(Date.parse(query.update.mock.calls[0][0].hidden_at))).toBe(false);
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/accounts", "/dashboard", "/auto", "/categories"]);
  });

  it("returns a safe error without refreshing when no eligible row is updated", async () => {
    const query = adminQuery();
    query.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await hideDisconnectedTikTokAccount(accountId, { error: null });
    expect(result.error).toContain("ยกเลิกการเชื่อมต่อ");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an invalid account id before contacting the database", async () => {
    const result = await hideDisconnectedTikTokAccount("not-an-account-id", { error: null });
    expect(result.error).toBeTruthy();
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
