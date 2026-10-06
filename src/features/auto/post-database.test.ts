import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("executes all migrations and account-scoped RPCs in isolated PostgreSQL without credentials", () => {
  const result = execFileSync(process.execPath, [resolve("scripts/verify-post-multi-account-sql.mjs")],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 100_000 });
  expect(result).toContain('"syntax":"PASS"');
  const summary = JSON.parse(result.trim().split("\n").at(-1)!);
  expect(summary.databaseCases).toBeGreaterThanOrEqual(42);
  expect(result).toContain('"result":"PASS","networkCalls":0,"paidCalls":0');
}, 30_000);
