import { AI_LIVE_REALTIME_VALIDATED, type LocalMachineView } from "./local-contract";

export type CustomerStreamPhase = "IDLE" | "PREPARING" | "CONNECTING" | "LIVE" | "RECONNECTING"
  | "STOPPING" | "STOPPED" | "SETUP_REQUIRED" | "ERROR";
export type CustomerConnectionQuality = "GOOD" | "FAIR" | "PROBLEM" | "UNAVAILABLE";
export interface CustomerStreamStatus {
  phase: CustomerStreamPhase;
  connectionQuality: CustomerConnectionQuality;
}

const phaseLabels: Record<CustomerStreamPhase, string> = {
  IDLE: "ยังไม่เริ่มไลฟ์", PREPARING: "กำลังเตรียม", CONNECTING: "กำลังเชื่อมต่อ", LIVE: "กำลัง LIVE",
  RECONNECTING: "เชื่อมต่อใหม่", STOPPING: "กำลังหยุด", STOPPED: "หยุดแล้ว",
  SETUP_REQUIRED: "ต้องตั้งค่าการ LIVE", ERROR: "ต้องตรวจสอบการ LIVE",
};
const qualityLabels: Record<CustomerConnectionQuality, string> = {
  GOOD: "ดี", FAIR: "พอใช้", PROBLEM: "มีปัญหา", UNAVAILABLE: "ยังไม่มีข้อมูล",
};

/** The customer contract accepts enum values only, never engine messages or diagnostics. */
export function projectCustomerStreamStatus(value: unknown): CustomerStreamStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { phase: "IDLE", connectionQuality: "UNAVAILABLE" };
  }
  const data = value as Record<string, unknown>;
  const phase = typeof data.phase === "string" && Object.hasOwn(phaseLabels, data.phase)
    ? data.phase as CustomerStreamPhase : "IDLE";
  const connectionQuality = typeof data.connectionQuality === "string" && Object.hasOwn(qualityLabels, data.connectionQuality)
    ? data.connectionQuality as CustomerConnectionQuality : "UNAVAILABLE";
  return { phase, connectionQuality };
}

/** Session existence is not evidence that any stream is reaching its destination. */
export function customerLiveStatus(view: LocalMachineView | null, action: "start" | "stop" | null = null): string {
  if (action === "stop" || view?.state === "STOPPING") return phaseLabels.STOPPING;
  if (action === "start") return phaseLabels.PREPARING;
  if (!view || ["INSTALLING", "STARTING"].includes(view.state)) return phaseLabels.PREPARING;
  const stream = projectCustomerStreamStatus(view.customerStream);
  if (view.paired && view.sessionActive) {
    if (view.state === "ERROR" || view.state === "OFFLINE") return phaseLabels.ERROR;
    if (view.state === "PAUSED" && AI_LIVE_REALTIME_VALIDATED && view.deviceAuthorized) return "AI หยุดชั่วคราว";
    if (AI_LIVE_REALTIME_VALIDATED && view.deviceAuthorized && ["LIVE", "RECONNECTING", "CONNECTING"].includes(stream.phase)) {
      return phaseLabels[stream.phase];
    }
    return phaseLabels.PREPARING;
  }
  if (view.paired && stream.phase === "STOPPED") return phaseLabels.STOPPED;
  if (view.canStart && view.deviceAuthorized && view.membershipStatus === "SUPPORTED") return "พร้อม";
  return phaseLabels.SETUP_REQUIRED;
}

export function customerConnectionQuality(view: LocalMachineView | null): string {
  if (!view?.paired || !view.sessionActive || !AI_LIVE_REALTIME_VALIDATED) return qualityLabels.UNAVAILABLE;
  return qualityLabels[projectCustomerStreamStatus(view.customerStream).connectionQuality];
}
