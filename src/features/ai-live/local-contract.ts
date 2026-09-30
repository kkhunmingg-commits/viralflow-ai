export const AI_LIVE_EXECUTION_MODE = "LOCAL_GPU" as const;
// This release has not passed the NVIDIA acceptance checklist.
export const AI_LIVE_REALTIME_VALIDATED = false;
export const LIVE_COMPONENT_VERSIONS = {
  web: "0.1.0", agent: "0.1.0", worker: "0.1.0", model: "musetalk-unvalidated",
} as const;

export type LocalAgentState = "NOT_INSTALLED" | "INSTALLING" | "STARTING" | "READY" | "BUSY"
  | "PAUSED" | "STOPPING" | "OFFLINE" | "ERROR" | "UPDATE_REQUIRED" | "GPU_REQUIRED";
export interface LocalMachineView {
  state: LocalAgentState;
  message: string;
  reasons: string[];
  paired: boolean;
  canStart: boolean;
  sessionActive: boolean;
}
export function compatibleLiveVersions(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(LIVE_COMPONENT_VERSIONS).every(([key, expected]) =>
    (value as Record<string, unknown>)[key] === expected);
}

const stateMessages: Record<LocalAgentState, string> = {
  NOT_INSTALLED: "ต้องติดตั้งส่วนเสริม", INSTALLING: "กำลังเตรียม", STARTING: "กำลังเตรียม",
  READY: "พร้อมใช้งาน", BUSY: "กำลังทำงาน", PAUSED: "หยุดชั่วคราว", STOPPING: "กำลังหยุด", OFFLINE: "ส่วนเสริมไม่ได้เชื่อมต่อ",
  ERROR: "ต้องตรวจสอบส่วนเสริม", UPDATE_REQUIRED: "ต้องอัปเดต", GPU_REQUIRED: "เครื่องไม่รองรับ",
};
const safeReasons = new Set([
  "ไม่พบการ์ดจอที่รองรับ", "หน่วยความจำการ์ดจอไม่เพียงพอ", "หน่วยความจำเครื่องไม่เพียงพอ",
  "ต้องอัปเดตไดรเวอร์", "พื้นที่จัดเก็บไม่เพียงพอ", "ไม่พบอุปกรณ์เสียง",
  "ต้องตรวจสอบความพร้อมของเครื่องเพิ่มเติม", "กำลังรอการทดสอบการแสดงสดบนเครื่องที่รองรับ",
  "กรุณาเชื่อมส่วนเสริมกับบัญชีของคุณ",
  "ระบบปฏิบัติการยังไม่รองรับ",
]);
export function localMachineView(state: LocalAgentState, paired = false, reasons: string[] = [], sessionActive = false): LocalMachineView {
  return { state, message: stateMessages[state], paired, sessionActive, canStart: false,
    reasons: [...new Set(reasons.map((reason) => safeReasons.has(reason) ? reason : "ต้องตรวจสอบความพร้อมของเครื่องเพิ่มเติม"))].slice(0, 8) };
}
export function projectLocalMachine(value: unknown, paired: boolean): LocalMachineView {
  if (!value || typeof value !== "object") return localMachineView("ERROR", paired);
  const data = value as Record<string, unknown>;
  // A version mismatch blocks Start, while an authenticated owner may still Stop.
  if (!compatibleLiveVersions(data.versions)) return localMachineView("UPDATE_REQUIRED", paired, [], paired && data.sessionActive === true);
  const state = typeof data.state === "string" && Object.hasOwn(stateMessages, data.state)
    ? data.state as LocalAgentState : "ERROR";
  const reasons = Array.isArray(data.reasons) ? data.reasons.filter((item): item is string => typeof item === "string") : [];
  if (!AI_LIVE_REALTIME_VALIDATED && state === "READY") reasons.push("กำลังรอการทดสอบการแสดงสดบนเครื่องที่รองรับ");
  return localMachineView(state, paired, reasons, data.sessionActive === true);
}
