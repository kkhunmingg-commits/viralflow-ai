import type { AutoAccountState, AutoRun, AutoState } from "./types";

const stateCopy: Record<AutoState, { title: string; detail: string; tone: string }> = {
  IDLE: { title: "พร้อมเริ่ม", detail: "เลือกบัญชี โหมด เป้าหมาย และงบรายวัน", tone: "neutral" },
  STARTING: { title: "กำลังเตรียม", detail: "กำลังสร้างแผนและตรวจเงื่อนไข", tone: "running" },
  RUNNING: { title: "แผนกำลังทำงาน", detail: "ดูขั้นตอนที่มีหลักฐานจริงด้านล่าง", tone: "running" },
  PAUSED: { title: "พักงานชั่วคราว", detail: "เริ่มต่อได้จากสถานะที่บันทึกไว้", tone: "waiting" },
  WAITING_FOR_DATA: { title: "รอข้อมูล", detail: "ต้องมีข้อมูล Analytics ที่ใช้ตัดสินใจได้", tone: "waiting" },
  WAITING_FOR_APPROVAL: { title: "รออนุมัติ", detail: "ต้องได้รับความยินยอมและผ่านการตรวจเผยแพร่", tone: "waiting" },
  WAITING_FOR_SLOT: { title: "รอคิวเผยแพร่", detail: "บัญชีถึงขีดจำกัดโพสต์วันนี้แล้ว", tone: "waiting" },
  WAITING_FOR_PROVIDER: { title: "ต้องตั้งค่าผู้สร้างวิดีโอ", detail: "ผู้ให้บริการยังไม่พร้อมหรือยังไม่ได้รับอนุมัติ", tone: "waiting" },
  WAITING_FOR_RECONCILIATION: { title: "รอยืนยันผลภายนอก", detail: "ระบบจะตรวจผลการส่งเดิมก่อนทำงานต่อ และจะไม่ส่งซ้ำ", tone: "waiting" },
  RETRY_PENDING: { title: "รอตรวจและลองใหม่", detail: "ระบบจะตรวจผลเดิมก่อนทำซ้ำ", tone: "waiting" },
  BLOCKED: { title: "ต้องแก้เงื่อนไข", detail: "ตรวจสุขภาพบัญชี สิทธิ์ และงบที่ตั้งไว้", tone: "blocked" },
  COMPLETED: { title: "เสร็จแล้ว", detail: "แผนวันนี้สิ้นสุดแล้ว", tone: "success" },
  FAILED: { title: "งานไม่สำเร็จ", detail: "เปิดการดำเนินงานเพื่อตรวจเหตุและกู้คืน", tone: "failed" },
  STOPPED: { title: "หยุดแล้ว", detail: "ไม่มีการส่งงานใหม่จากแผนนี้", tone: "neutral" },
};

export const operatorStages = [
  ["PLAN_ACCOUNTS", "เตรียมแผน"], ["FIND_OPPORTUNITY", "หาโอกาสคอนเทนต์"],
  ["CREATE_CREATIVE", "สร้างไอเดีย"], ["GENERATE_VIDEO", "สร้างวิดีโอ"],
  ["QUALITY_CHECK", "ตรวจคุณภาพ"], ["COMPLIANCE_CHECK", "ตรวจข้อกำหนด"],
  ["QUEUE_PUBLISH", "เข้าคิวเผยแพร่"], ["PUBLISH", "เผยแพร่"],
  ["COLLECT_ANALYTICS", "เก็บผลลัพธ์"], ["LEARN", "เรียนรู้"],
] as const;

export function describeOperatorRun(run: AutoRun | null, accountState?: AutoAccountState) {
  const state = accountState?.state ?? run?.state ?? "IDLE";
  const copy = stateCopy[state];
  const blockers = accountState?.blockers_json ?? run?.blockers_json ?? [];
  const setupRequired = blockers.some((code) => ["PROVIDER_UNAVAILABLE", "ACCOUNT_HEALTH", "BUDGET_EXCEEDED", "CONSENT", "COMMERCE"].includes(code));
  return { ...copy, state, blockers, setupRequired };
}

export function canStartOperatorRun(run: AutoRun | null) {
  return !run || ["COMPLETED", "FAILED", "STOPPED"].includes(run.state);
}

export function realProviderAllowedForAccount(providerAvailable: boolean, isMock: boolean) {
  return providerAvailable && !isMock;
}

export function operatorStepLabel(step: string) {
  if (step === "PAUSE") return "พักงาน";
  if (step === "RESUME") return "กลับมาตรวจเงื่อนไข";
  if (step === "STOP") return "หยุดงาน";
  return operatorStages.find(([code]) => code === step)?.[1] ?? "รอตรวจขั้นตอน";
}
