import { projectCustomerStreamStatus, type CustomerStreamStatus } from "./customer-stream-status";

export const AI_LIVE_EXECUTION_MODE = "LOCAL_GPU" as const;
// This release has not passed the NVIDIA acceptance checklist.
export const AI_LIVE_REALTIME_VALIDATED = false;
export const LIVE_COMPONENT_VERSIONS = {
  web: "0.4.0", agent: "0.4.0", worker: "0.4.0", model: "musetalk-unvalidated",
} as const;

export type LocalAgentState = "NOT_INSTALLED" | "INSTALLING" | "STARTING" | "READY" | "BUSY"
  | "PAUSED" | "STOPPING" | "OFFLINE" | "ERROR" | "UPDATE_REQUIRED" | "GPU_REQUIRED";
export type LocalComponentsState = "NOT_CONFIGURED" | "CHECKING" | "DOWNLOADING" | "VERIFYING"
  | "INSTALLING" | "READY" | "REPAIR_REQUIRED" | "ERROR";
export interface LocalComponentsView {
  state: LocalComponentsState;
  bytesReceived: number;
  totalBytes: number;
  canPrepare: boolean;
  message: string;
}
const componentMessages: Record<LocalComponentsState, string> = {
  NOT_CONFIGURED: "ยังไม่ได้เตรียมส่วนประกอบ", CHECKING: "กำลังตรวจสอบเครื่อง",
  DOWNLOADING: "กำลังดาวน์โหลดส่วนประกอบ", VERIFYING: "กำลังตรวจสอบไฟล์",
  INSTALLING: "กำลังติดตั้งส่วนประกอบ", READY: "ส่วนประกอบพร้อม",
  REPAIR_REQUIRED: "ต้องเตรียมส่วนประกอบอีกครั้ง", ERROR: "เตรียมส่วนประกอบไม่สำเร็จ",
};
export function projectLocalComponents(value: unknown): LocalComponentsView {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const recognized = typeof data.state === "string" && Object.hasOwn(componentMessages, data.state);
  const state = recognized ? data.state as LocalComponentsState : "ERROR";
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return { state, bytesReceived: count(data.bytesReceived), totalBytes: count(data.totalBytes),
    canPrepare: recognized && data.canPrepare === true && ["NOT_CONFIGURED", "READY", "REPAIR_REQUIRED", "ERROR"].includes(state),
    message: componentMessages[state] };
}
export interface LocalMachineView {
  customerStream?: CustomerStreamStatus;
  components?: LocalComponentsView;
  hardwareAdvice?: "DRIVER_UPDATE_REQUIRED";
  machineReady?: boolean;
  state: LocalAgentState;
  message: string;
  reasons: string[];
  paired: boolean;
  canStart: boolean;
  sessionActive: boolean;
  deviceAuthorized: boolean;
  deviceRegistered: boolean;
  membershipStatus: "SUPPORTED" | "UNSUPPORTED" | "UNAVAILABLE";
  deviceStatus: "UNREGISTERED" | "AUTHORIZED" | "UNAVAILABLE" | "MEMBERSHIP_REQUIRED";
  updateStatus: "CURRENT" | "AVAILABLE" | "UPDATING" | "RESTART_REQUIRED" | "REQUIRED" | "NOT_CONFIGURED" | "ROLLED_BACK";
  updateCanApply: boolean;
  updateCanRepair: boolean;
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
    deviceAuthorized: false, deviceRegistered: false, membershipStatus: "UNAVAILABLE", deviceStatus: "UNREGISTERED",
    updateStatus: state === "UPDATE_REQUIRED" ? "REQUIRED" : "CURRENT", updateCanApply: false, updateCanRepair: false,
    reasons: [...new Set(reasons.map((reason) => safeReasons.has(reason) ? reason : "ต้องตรวจสอบความพร้อมของเครื่องเพิ่มเติม"))].slice(0, 8) };
}
export function projectLocalMachine(value: unknown, paired: boolean): LocalMachineView {
  if (!value || typeof value !== "object") return localMachineView("ERROR", paired);
  const data = value as Record<string, unknown>;
  // A version mismatch blocks Start, while an authenticated owner may still Stop.
  if (!compatibleLiveVersions(data.versions)) {
    const incompatible = localMachineView("UPDATE_REQUIRED", paired, [], paired && data.sessionActive === true);
    incompatible.updateCanApply = paired && data.updateCanApply === true && !incompatible.sessionActive;
    return incompatible;
  }
  const state = typeof data.state === "string" && Object.hasOwn(stateMessages, data.state)
    ? data.state as LocalAgentState : "ERROR";
  const reasons = Array.isArray(data.reasons) ? data.reasons.filter((item): item is string => typeof item === "string") : [];
  if (!AI_LIVE_REALTIME_VALIDATED && state === "READY") reasons.push("กำลังรอการทดสอบการแสดงสดบนเครื่องที่รองรับ");
  const result = localMachineView(state, paired, reasons, data.sessionActive === true);
  if (["AVAILABLE", "UPDATING", "RESTART_REQUIRED", "REQUIRED", "NOT_CONFIGURED", "ROLLED_BACK"].includes(String(data.updateStatus))) {
    result.updateStatus = data.updateStatus as LocalMachineView["updateStatus"];
  }
  result.updateCanApply = paired && data.updateCanApply === true && !result.sessionActive;
  result.updateCanRepair = paired && data.updateCanRepair === true && !result.sessionActive;
  if (paired) result.customerStream = projectCustomerStreamStatus(data.customerStream);
  if (paired && data.components !== undefined) result.components = projectLocalComponents(data.components);
  if (paired && data.hardwareAdvice === "DRIVER_UPDATE_REQUIRED") result.hardwareAdvice = "DRIVER_UPDATE_REQUIRED";
  if (paired && typeof data.machineReady === "boolean") result.machineReady = data.machineReady;
  // Cloud registry confirmation is added by the authenticated browser bridge.
  return result;
}
