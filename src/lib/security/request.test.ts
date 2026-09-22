import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import {
  RequestSecurityError,
  assertRateLimitResult,
  readJsonBodyWithLimit,
  requestFingerprint,
  securityErrorResponse,
} from "./request";

describe("Phase 11A request security", () => {
  it("rejects non-JSON and oversized bodies before parsing", async () => {
    await expect(readJsonBodyWithLimit(new Request("https://app.test/webhook", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    }), 64)).rejects.toMatchObject({ code: "unsupported_media_type", status: 415 });

    await expect(readJsonBodyWithLimit(new Request("https://app.test/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1000" },
      body: "{}",
    }), 64)).rejects.toMatchObject({ code: "payload_too_large", status: 413 });

    await expect(readJsonBodyWithLimit(new Request("https://app.test/webhook", {
      method: "POST",
      headers: { "content-type": "application/jsonp", "content-length": "1e2" },
      body: "{}",
    }), 64)).rejects.toMatchObject({ code: "unsupported_media_type", status: 415 });

    await expect(readJsonBodyWithLimit(new Request("https://app.test/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1e2" },
      body: "{}",
    }), 64)).rejects.toMatchObject({ code: "invalid_content_length", status: 400 });

    await expect(readJsonBodyWithLimit(new Request("https://app.test/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(100) }),
    }), 64)).rejects.toMatchObject({ code: "payload_too_large", status: 413 });
  });

  it("accepts bounded JSON and hashes request identifiers", async () => {
    const request = new Request("https://app.test/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      },
      body: JSON.stringify({ ok: true }),
    });
    expect(await readJsonBodyWithLimit(request.clone(), 1024)).toBe('{"ok":true}');
    const fingerprint = requestFingerprint(request, "owner-id");
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint).not.toContain("203.0.113.10");
  });

  it("returns bounded public security errors without leaking internal messages", async () => {
    const response = securityErrorResponse(new RequestSecurityError("rate_limited", 429));
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("60");
    expect(await response?.json()).toEqual({ error: "rate_limited" });
    expect(securityErrorResponse(new Error("secret internal detail"))).toBeNull();
  });

  it("allows, limits, and fails closed through the shared database counter", async () => {
    expect(() => assertRateLimitResult(true, null)).not.toThrow();
    expect(() => assertRateLimitResult(false, null)).toThrow(expect.objectContaining({ code: "rate_limited", status: 429 }));
    expect(() => assertRateLimitResult(null, { message: "internal secret" })).toThrow(expect.objectContaining({ code: "rate_limit_unavailable", status: 503 }));
  });

  it("keeps the shared rate limiter private and service-role only", () => {
    const sql = readFileSync("supabase/migrations/20260921123500_phase_11a_security_hardening.sql", "utf8");
    expect(sql).toContain("create table private.security_rate_limits");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("grant usage on schema private to service_role");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("grant execute on function public.consume_security_rate_limit(text, text, integer, integer) to authenticated");
  });

  it("applies the shared limiter to authenticated mutation groups", () => {
    for (const path of [
      "src/app/(app)/accounts/actions.ts",
      "src/app/(app)/accounts/tiktok-actions.ts",
      "src/app/(app)/publishing/actions.ts",
      "src/app/(app)/creative-studio/actions.ts",
      "src/app/(app)/video-factory/actions.ts",
      "src/app/(app)/auto/actions.ts",
      "src/app/(app)/recommendations/actions.ts",
      "src/app/(app)/categories/actions.ts",
      "src/app/(app)/product-radar/actions.ts",
    ]) {
      expect(readFileSync(path, "utf8"), path).toContain("enforceOwnerMutationRateLimit");
    }
  });

  it("keeps unauthenticated application routes behind the proxy guard", () => {
    const proxy = readFileSync("src/lib/supabase/proxy.ts", "utf8");
    expect(proxy).toContain("supabase.auth.getClaims()");
    expect(proxy).toContain("!data?.claims && !isPublic");
    expect(proxy).toContain('url.pathname = "/login"');
  });

  it("keeps representative owner data behind auth.uid RLS predicates", () => {
    const foundation = readFileSync("supabase/migrations/20260914112027_phase_1_foundation.sql", "utf8");
    const video = readFileSync("supabase/migrations/20260915195004_phase_6_video_factory.sql", "utf8");
    const publishing = readFileSync("supabase/migrations/20260917191816_phase_7b_tiktok_publishing_foundation.sql", "utf8");
    expect(foundation).toContain("on public.tiktok_accounts for select\nto authenticated\nusing ((select auth.uid()) = owner_id)");
    expect(video).toContain("on public.master_videos for select to authenticated using((select auth.uid())=owner_id)");
    expect(publishing).toContain("on public.publishing_queue\nfor select to authenticated using ((select auth.uid()) = owner_id)");
  });

  it("ships baseline security headers", async () => {
    const rules = await nextConfig.headers!();
    const headers = new Map(rules[0]!.headers.map(item => [item.key, item.value]));
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=");
  });

  it("keeps sensitive server variables outside NEXT_PUBLIC", () => {
    const example = readFileSync(".env.example", "utf8");
    for (const name of [
      "FAL_KEY",
      "GOOGLE_GENAI_API_KEY",
      "TIKTOK_CLIENT_SECRET",
      "TIKTOK_TOKEN_ENCRYPTION_KEY",
      "SUPABASE_SECRET_KEY",
    ]) {
      expect(example).toMatch(new RegExp("^" + name + "=", "m"));
      expect(example).not.toContain("NEXT_PUBLIC_" + name);
    }
  });
});
