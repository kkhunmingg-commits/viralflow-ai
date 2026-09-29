/** Read-only presentation of durable Auto evidence. No processor state is changed here. */
export type ControlCenterStageId =
  | "PRODUCT" | "CREATIVE" | "SCRIPT" | "VIDEO"
  | "QUALITY" | "PUBLISH" | "ANALYTICS" | "LEARNING";

export type ControlCenterStageState = "completed" | "active" | "waiting" | "failed";

export interface ControlCenterStepEvidence {
  id: string;
  step: string;
  state: string;
  created_at?: string | null;
  completed_at?: string | null;
  input_json?: Record<string, unknown> | null;
  output_json?: Record<string, unknown> | null;
}

export interface ControlCenterStage {
  id: ControlCenterStageId;
  label: string;
  state: ControlCenterStageState;
}

export interface ControlCenterActivity {
  id: string;
  step: string;
  title: string;
  state: "completed" | "waiting" | "failed";
  occurredAt: string;
}

interface StageInput {
  steps: readonly ControlCenterStepEvidence[];
  currentStep?: string | null;
  currentState?: string | null;
  checkpoint?: Record<string, unknown> | null;
  itemIndex?: number | null;
}

const stages: ReadonlyArray<{ id: ControlCenterStageId; label: string; steps: readonly string[] }> = [
  { id: "PRODUCT", label: "Product", steps: ["FIND_OPPORTUNITY"] },
  { id: "CREATIVE", label: "Creative", steps: ["CREATE_CREATIVE"] },
  { id: "SCRIPT", label: "Script", steps: [] },
  { id: "VIDEO", label: "Video", steps: ["GENERATE_VIDEO"] },
  { id: "QUALITY", label: "Quality", steps: ["QUALITY_CHECK", "COMPLIANCE_CHECK"] },
  { id: "PUBLISH", label: "Publish", steps: ["QUEUE_PUBLISH", "PUBLISH"] },
  { id: "ANALYTICS", label: "Analytics", steps: ["COLLECT_ANALYTICS"] },
  { id: "LEARNING", label: "Learning", steps: ["LEARN"] },
];

function positiveItemIndex(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(number) && number > 0 ? number : null;
}

function forCurrentItem(steps: readonly ControlCenterStepEvidence[], itemIndex?: number | null) {
  if (itemIndex == null) return steps;
  return steps.filter((step) => positiveItemIndex(step.input_json?.itemIndex) === itemIndex);
}

function hasScriptEvidence(checkpoint: StageInput["checkpoint"], itemIndex: StageInput["itemIndex"], steps: readonly ControlCenterStepEvidence[]) {
  const checkpointMatches = itemIndex == null || positiveItemIndex(checkpoint?.itemIndex) === itemIndex;
  if (checkpointMatches && typeof checkpoint?.scriptId === "string" && checkpoint.scriptId.length > 0) return true;
  return steps.some((step) => step.step === "CREATE_CREATIVE" && step.state === "COMPLETED"
    && typeof step.output_json?.scriptId === "string" && step.output_json.scriptId.length > 0);
}

/** A stage is complete only when its existing backend step(s) have completed. */
export function mapControlCenterStages({ steps, currentStep, currentState, checkpoint, itemIndex }: StageInput): ControlCenterStage[] {
  const itemSteps = forCurrentItem(steps, itemIndex);
  const completed = new Set(itemSteps.filter((step) => step.state === "COMPLETED").map((step) => step.step));
  const scriptReady = hasScriptEvidence(checkpoint, itemIndex, itemSteps);
  const activeState = currentState === "RUNNING" || currentState === "STARTING" || currentState === "RETRY_PENDING";
  const failedState = currentState === "FAILED" || currentState === "BLOCKED";

  return stages.map(({ id, label, steps: required }) => {
    // Script is evidence inside CREATE_CREATIVE, not an independent processor stage.
    const isComplete = id === "SCRIPT" ? scriptReady : required.every((step) => completed.has(step));
    const isCurrent = required.includes(currentStep ?? "");
    const state: ControlCenterStageState = isComplete ? "completed"
      : isCurrent && failedState ? "failed"
      : isCurrent && activeState ? "active"
      : "waiting";
    return { id, label, state };
  });
}

const completedTitles: Record<string, string> = {
  FIND_OPPORTUNITY: "เลือกสินค้าแล้ว",
  CREATE_CREATIVE: "ครีเอทีฟพร้อม",
  GENERATE_VIDEO: "สร้างวิดีโอเสร็จ",
  QUALITY_CHECK: "ตรวจคุณภาพผ่าน",
  COMPLIANCE_CHECK: "ตรวจความปลอดภัยผ่าน",
  QUEUE_PUBLISH: "เข้าคิวเผยแพร่แล้ว",
  PUBLISH: "ขั้นเผยแพร่เสร็จ",
  COLLECT_ANALYTICS: "อัปเดตผลวิเคราะห์แล้ว",
  LEARN: "เรียนรู้จากผลลัพธ์แล้ว",
};

const activitySubjects: Record<string, string> = {
  FIND_OPPORTUNITY: "เลือกสินค้า",
  CREATE_CREATIVE: "สร้างครีเอทีฟ",
  GENERATE_VIDEO: "สร้างวิดีโอ",
  QUALITY_CHECK: "ตรวจคุณภาพ",
  COMPLIANCE_CHECK: "ตรวจความปลอดภัย",
  QUEUE_PUBLISH: "เข้าคิวเผยแพร่",
  PUBLISH: "เผยแพร่",
  COLLECT_ANALYTICS: "เก็บผลวิเคราะห์",
  LEARN: "เรียนรู้",
};

function activityTitle(step: ControlCenterStepEvidence): string | null {
  const base = completedTitles[step.step];
  if (!base) return null;
  if (step.state === "COMPLETED") {
    if (step.step === "CREATE_CREATIVE" && typeof step.output_json?.scriptId === "string" && step.output_json.scriptId) {
      return "ครีเอทีฟและสคริปต์พร้อม";
    }
    if (step.step === "PUBLISH" && step.output_json?.publishStatus === "PUBLISHED") return "เผยแพร่สำเร็จ";
    return base;
  }
  if (step.state === "WAITING") return `รอ${activitySubjects[step.step]}`;
  if (step.state === "FAILED") return `${activitySubjects[step.step]}ไม่สำเร็จ`;
  return null;
}

/** Recent feed items correspond one-to-one with persisted, timestamped step rows. */
export function mapControlCenterActivity({ steps, itemIndex, limit = 8 }: {
  steps: readonly ControlCenterStepEvidence[];
  itemIndex?: number | null;
  limit?: number;
}): ControlCenterActivity[] {
  const boundedLimit = Math.max(0, Math.min(12, Number.isFinite(limit) ? Math.floor(limit) : 8));
  return forCurrentItem(steps, itemIndex).flatMap((step) => {
    const title = activityTitle(step);
    const occurredAt = step.completed_at ?? step.created_at;
    if (!title || !occurredAt || !Number.isFinite(Date.parse(occurredAt))) return [];
    const state: ControlCenterActivity["state"] = step.state === "COMPLETED" ? "completed"
      : step.state === "FAILED" ? "failed" : "waiting";
    return [{ id: step.id, step: step.step, title, state, occurredAt }];
  }).sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)).slice(0, boundedLimit);
}
