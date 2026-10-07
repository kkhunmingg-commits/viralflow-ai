import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("executes all migrations and account-scoped RPCs in isolated PostgreSQL without credentials", () => {
  const result = execFileSync(process.execPath, [resolve("scripts/verify-post-multi-account-sql.mjs")],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 100_000 });
  expect(result).toContain('"syntax":"PASS"');
  const lines = result.trim().split("\n");
  const schedulingSummary = JSON.parse(lines.find((line) => line.includes('"schedulingFixture"'))!);
  expect(schedulingSummary.schedulingFixture).toMatch(/^\d{4}-\d{2}-\d{2}T06:00:00Z$/);
  expect(schedulingSummary.clockProof).toBe("PASS");
  const summary = JSON.parse(lines.at(-1)!);
  expect(summary.databaseCases).toBeGreaterThanOrEqual(92);
  expect(summary.populatedMigrationReplay).toBe("PASS");
  expect(result).toContain('"result":"PASS","networkCalls":0,"paidCalls":0');
}, 30_000);
