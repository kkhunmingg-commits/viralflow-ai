import { projectCustomerStreamStatus, type CustomerStreamStatus } from "./customer-stream-status";

export const AI_LIVE_EXECUTION_MODE = "LOCAL_GPU" as const;
// This release has not passed the NVIDIA acceptance checklist.
export const AI_LIVE_REALTIME_VALIDATED = false;
export const LIVE_COMPONENT_VERSIONS = {
  web: "0.5.0", agent: "0.5.0", worker: "0.5.0", model: "musetalk-unvalidated",
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
  aiReadiness?: LocalAIReadiness;
  rooms?: LocalRoomView[];
  capacity?: LocalRoomCapacity;
  activeAccountId?: string;
  currentProductId?: string;
  sessionStartedAt?: number;
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
export interface LocalAIReadiness {
  brain: "READY" | "PREPARING" | "UNAVAILABLE";
  voice: "READY" | "PREPARING" | "UNAVAILABLE";
  presenter: "READY" | "PREPARING" | "UNAVAILABLE";
  encoder: "READY" | "PREPARING" | "UNAVAILABLE";
}
export function projectLocalAIReadiness(value: unknown): LocalAIReadiness {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const state = (key: string): LocalAIReadiness["brain"] => data[key] === "READY" ? "READY"
    : data[key] === "PREPARING" ? "PREPARING" : "UNAVAILABLE";
  return { brain: state("brain"), voice: state("voice"), presenter: state("presenter"), encoder: state("encoder") };
}
/** Opaque routing identifiers remain inside the authenticated bridge, never customer labels. */
export interface LocalRoomView {
  accountId: string;
  sessionId: string;
  state: "BUSY" | "PAUSED" | "STOPPING" | "STOPPED" | "ERROR";
  currentProductId: string | null;
  sessionStartedAt: number | null;
  customerStream: CustomerStreamStatus;
}
export interface LocalRoomCapacity {
  status: "UNVERIFIED_CAPACITY" | "VERIFIED";
  maximumRooms: number | null;
  activeRooms: number;
  canStartAnotherRoom: boolean;
}
const roomIdentifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function projectLocalRooms(value: unknown): LocalRoomView[] {
  if (!Array.isArray(value) || value.length > 10) return [];
  const accounts = new Set<string>();
  const sessions = new Set<string>();
  const rooms: LocalRoomView[] = [];
  for (const input of value) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return [];
    const room = input as Record<string, unknown>;
    if (typeof room.accountId !== "string" || !roomIdentifier.test(room.accountId)
      || typeof room.sessionId !== "string" || !roomIdentifier.test(room.sessionId)
      || !["BUSY", "PAUSED", "STOPPING", "STOPPED", "ERROR"].includes(String(room.state))
      || accounts.has(room.accountId) || sessions.has(room.sessionId)) return [];
    accounts.add(room.accountId); sessions.add(room.sessionId);
    rooms.push({ accountId: room.accountId, sessionId: room.sessionId, state: room.state as LocalRoomView["state"],
      currentProductId: typeof room.currentProductId === "string" && roomIdentifier.test(room.currentProductId) ? room.currentProductId : null,
      sessionStartedAt: typeof room.sessionStartedAt === "number" && Number.isSafeInteger(room.sessionStartedAt) && room.sessionStartedAt >= 0 ? room.sessionStartedAt : null,
      customerStream: projectCustomerStreamStatus(room.customerStream) });
  }
  return rooms;
}
export function projectLocalCapacity(value: unknown): LocalRoomCapacity {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const verified = input.status === "VERIFIED" && typeof input.maximumRooms === "number"
    && Number.isSafeInteger(input.maximumRooms) && input.maximumRooms >= 1 && input.maximumRooms <= 10;
  const activeRooms = typeof input.activeRooms === "number" && Number.isSafeInteger(input.activeRooms)
    && input.activeRooms >= 0 && input.activeRooms <= 10 ? input.activeRooms : 0;
  const maximumRooms = verified ? input.maximumRooms as number : null;
  return { status: verified ? "VERIFIED" : "UNVERIFIED_CAPACITY", maximumRooms, activeRooms,
    canStartAnotherRoom: verified && input.canStartAnotherRoom === true && activeRooms < maximumRooms! };
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
    if (paired) { incompatible.rooms = projectLocalRooms(data.rooms); incompatible.capacity = projectLocalCapacity(data.capacity); }
    return incompatible;
  }
  const state = typeof data.state === "string" && Object.hasOwn(stateMessages, data.state)
    ? data.state as LocalAgentState : "ERROR";
  const reasons = Array.isArray(data.reasons) ? data.reasons.filter((item): item is string => typeof item === "string") : [];
  if (!AI_LIVE_REALTIME_VALIDATED && state === "READY") reasons.push("กำลังรอการทดสอบการแสดงสดบนเครื่องที่รองรับ");
  const result = localMachineView(state, paired, reasons, data.sessionActive === true);
  if (paired) {
    result.rooms = projectLocalRooms(data.rooms);
    result.capacity = projectLocalCapacity(data.capacity);
    result.aiReadiness = projectLocalAIReadiness(data.aiReadiness);
  }
  if (paired && result.sessionActive) {
    const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof data.activeAccountId === "string" && identifier.test(data.activeAccountId)) result.activeAccountId = data.activeAccountId;
    if (typeof data.currentProductId === "string" && identifier.test(data.currentProductId)) result.currentProductId = data.currentProductId;
    if (typeof data.sessionStartedAt === "number" && Number.isSafeInteger(data.sessionStartedAt) && data.sessionStartedAt >= 0) result.sessionStartedAt = data.sessionStartedAt;
  }
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
