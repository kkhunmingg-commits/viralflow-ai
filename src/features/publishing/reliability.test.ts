import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260923143000_phase_11b_exactly_once_atomic_budget.sql", "utf8");
const service = readFileSync("src/features/publishing/services.ts", "utf8");

describe("Phase 11B exactly-once publishing", () => {
  it("uses one stable external operation key and an owner-scoped unique constraint", () => {
    expect(migration).toContain("publishing_queue_external_operation_unique_idx");
    expect(migration).toContain("v_queue.external_operation_key || ':attempt:'");
    expect(service).toContain("p_external_operation_key: `tiktok:${input.idempotencyKey}`");
  });

  it("allows only one worker to claim an active lease", () => {
    expect(migration).toContain("pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':' || p_queue_id::text,0))");
    expect(migration).toContain("'LEASE_HELD'");
    expect(migration).toContain("lease_expires_at > now()");
  });

  it("separates pre-send expiry from post-send uncertainty", () => {
    expect(migration).toContain("LEASE_EXPIRED_BEFORE_SUBMISSION");
    expect(migration).toContain("LEASE_EXPIRED_AFTER_SUBMISSION_STARTED");
    expect(migration).toContain("external_state='SUBMITTED_UNKNOWN'");
    expect(migration).toContain("status='WAITING_FOR_RECONCILIATION'");
  });

  it("does not blindly retry an unknown submission", () => {
    expect(service).toContain('queue.external_state === "SUBMITTED_UNKNOWN"');
    expect(service).toContain('throw new PublishingError("publish_reconciliation_required")');
    expect(service).toContain('if (queue.provider_publish_id) return this.fetchPublishStatus');
  });

  it("applies duplicate webhooks and status evidence atomically", () => {
    expect(service).toContain('rpc("apply_publish_webhook_atomic"');
    expect(migration).toContain("on conflict(owner_id,provider_event_id)");
    expect(migration).toContain("'duplicate',true");
  });

  it("makes repeated Auto START and RESUME database-atomic", () => {
    expect(migration).toContain("create or replace function public.create_auto_run_atomic");
    expect(migration).toContain("create or replace function public.transition_auto_run_atomic");
    expect(migration).toContain("if found then return v_run");
    expect(migration).toContain("if v_next<>v_previous then");
  });
});
