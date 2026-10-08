import { describe, expect, it } from "vitest";
import { mapControlCenterActivity, mapControlCenterStages, mapCustomerStages, type ControlCenterStepEvidence } from "./control-center-view";

const at = (minute: number) => `2026-09-29T03:${String(minute).padStart(2, "0")}:00.000Z`;
const step = (id: string, name: string, state = "COMPLETED", itemIndex = 1,
  output_json: Record<string, unknown> = {}): ControlCenterStepEvidence => ({
  id, step: name, state, input_json: { itemIndex }, output_json,
  created_at: at(Number(id.replace(/\D/g, "")) || 1),
});
const stage = (rows: ControlCenterStepEvidence[], currentStep = "FIND_OPPORTUNITY",
  currentState = "RUNNING", itemIndex = 1, checkpoint: Record<string, unknown> = { itemIndex }) =>
  Object.fromEntries(mapControlCenterStages({ steps: rows, currentStep, currentState, itemIndex, checkpoint })
    .map((item) => [item.id, item.state]));

describe("Control Center evidence mapping", () => {
  it("does not present a separately completed Script stage without a real script ID", () => {
    const noScript = [step("s1", "FIND_OPPORTUNITY"), step("s2", "CREATE_CREATIVE")];
    expect(stage(noScript, "GENERATE_VIDEO")).toMatchObject({
      PRODUCT: "completed", CREATIVE: "completed", SCRIPT: "waiting", VIDEO: "active",
    });
    expect(stage([...noScript, step("s3", "CREATE_CREATIVE", "COMPLETED", 1, { scriptId: "real-script" })], "GENERATE_VIDEO")
      .SCRIPT).toBe("completed");
    expect(stage(noScript, "GENERATE_VIDEO", "RUNNING", 1, { itemIndex: 1, scriptId: "real-script" }).SCRIPT)
      .toBe("completed");
  });

  it("keeps evidence from a prior product out of the current product pipeline", () => {
    const firstProduct = [step("s1", "FIND_OPPORTUNITY"), step("s2", "CREATE_CREATIVE", "COMPLETED", 1, { scriptId: "old" })];
    expect(stage(firstProduct, "FIND_OPPORTUNITY", "RUNNING", 2, { itemIndex: 1, scriptId: "old" }))
      .toMatchObject({ PRODUCT: "active", CREATIVE: "waiting", SCRIPT: "waiting" });
  });

  it("requires both existing checks and both publish steps for their combined UI stages", () => {
    const rows = [step("s1", "QUALITY_CHECK"), step("s2", "QUEUE_PUBLISH")];
    expect(stage(rows, "COMPLIANCE_CHECK")).toMatchObject({ QUALITY: "active", PUBLISH: "waiting" });
    const checked = [...rows, step("s3", "COMPLIANCE_CHECK")];
    expect(stage(checked, "PUBLISH")).toMatchObject({ QUALITY: "completed", PUBLISH: "active" });
    expect(stage([...checked, step("s4", "PUBLISH")], "COLLECT_ANALYTICS"))
      .toMatchObject({ PUBLISH: "completed", ANALYTICS: "active" });
  });

  it("marks only the evidenced current backend step failed or waiting", () => {
    expect(stage([], "GENERATE_VIDEO", "BLOCKED")).toMatchObject({ VIDEO: "failed", QUALITY: "waiting" });
    expect(stage([], "PUBLISH", "WAITING_FOR_APPROVAL")).toMatchObject({ PUBLISH: "waiting", LEARNING: "waiting" });
  });

  it("builds a bounded, newest-first feed solely from timestamped persisted steps", () => {
    const rows = [
      step("s1", "CREATE_CREATIVE", "COMPLETED", 1, { scriptId: "real-script" }),
      step("s2", "PUBLISH", "COMPLETED", 1, { publishStatus: "PUBLISHED" }),
      step("s3", "LEARN", "COMPLETED", 2),
      { ...step("s4", "QUALITY_CHECK"), created_at: null },
    ];
    const feed = mapControlCenterActivity({ steps: rows, itemIndex: 1, limit: 2 });
    expect(feed.map((item) => item.title)).toEqual(["เผยแพร่สำเร็จ", "เนื้อหาและสคริปต์พร้อม"]);
    expect(feed.map((item) => item.id)).toEqual(["s2", "s1"]);
    expect(mapControlCenterActivity({ steps: rows, itemIndex: 1, limit: 0 })).toEqual([]);
    expect(mapControlCenterActivity({ steps: [], itemIndex: 1 })).toEqual([]);
  });

  it("shows six simple stages without claiming completion from partial evidence", () => {
    const stages = mapControlCenterStages({ steps: [step("s1", "FIND_OPPORTUNITY"), step("s2", "CREATE_CREATIVE")],
      currentStep: "GENERATE_VIDEO", currentState: "RUNNING", itemIndex: 1, checkpoint: { itemIndex: 1 } });
    expect(mapCustomerStages(stages).map(({ label, state }) => [label, state])).toEqual([
      ["สินค้า", "completed"], ["เนื้อหา", "waiting"], ["วิดีโอ", "active"],
      ["ตรวจสอบ", "waiting"], ["โพสต์", "waiting"], ["เสร็จ", "waiting"],
    ]);
  });

  it("does not claim publication when a completed step lacks PUBLISHED evidence", () => {
    const feed = mapControlCenterActivity({ steps: [step("s1", "PUBLISH", "COMPLETED", 1, { publishStatus: "DRAFT_DELIVERED" })] });
    expect(feed[0].title).toBe("ขั้นเผยแพร่เสร็จ");
  });

  it("presents completed EXPORT delivery as files rather than TikTok publication", () => {
    const rows = [step("s1", "QUEUE_PUBLISH", "COMPLETED", 1, { postingMode: "EXPORT" }),
      step("s2", "PUBLISH", "COMPLETED", 1, { postingMode: "EXPORT", publishStatus: "READY" })];
    const stages = mapControlCenterStages({ steps: rows, itemIndex: 1 });
    expect(mapCustomerStages(stages).find(item => item.id === "PUBLISH")).toMatchObject({ label: "ส่งออก", state: "completed" });
    expect(mapControlCenterActivity({ steps: rows }).map(item => item.title)).toEqual(["ไฟล์ส่งออกพร้อม", "ไฟล์ส่งออกพร้อม"]);
    expect(mapCustomerStages(mapControlCenterStages({ steps: rows, itemIndex: 2 })).find(item => item.id === "PUBLISH"))
      .toMatchObject({ label: "โพสต์", state: "waiting" });
  });

  it("does not claim analytics or learning happened when EXPORT deferred those steps", () => {
    const feed = mapControlCenterActivity({ steps: [
      step("s1", "COLLECT_ANALYTICS", "COMPLETED", 1, { analyticsDeferred: true, postingMode: "EXPORT" }),
      step("s2", "LEARN", "COMPLETED", 1, { learningDeferred: true }),
    ] });
    expect(feed.map(item => [item.title, item.state])).toEqual([
      ["รอผลลัพธ์เพื่อปรับแผน", "waiting"], ["รอผลลัพธ์หลังเผยแพร่", "waiting"],
    ]);
  });
});
