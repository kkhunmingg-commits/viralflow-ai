import type { LocalMachineView } from "./local-contract";
import { customerLiveStatus } from "./customer-stream-status";

export type LiveReadinessKey = "image" | "audio" | "brain" | "products" | "connection" | "backupVoice";
export type ReadinessState = "READY" | "WAITING" | "UNAVAILABLE";
export interface CustomerRoomRuntime {
  accountId: string;
  status: string;
  sessionActive: boolean;
  canStart: boolean;
  canManagePresenters: boolean;
  canLoadPresenterImages: boolean;
  paused: boolean;
  currentProductId: string | null;
  sessionStartedAt: number | null;
  readiness: Record<LiveReadinessKey, ReadinessState>;
}

/** Presence/configuration alone never proves speech, transport, or live sales. */
export function customerRoomRuntime(input: {
  accountId: string; machine: LocalMachineView | null; imageReady: boolean;
  microphoneReady: boolean; productsReady: boolean; busy: boolean; accountReady?: boolean;
}): CustomerRoomRuntime {
  const machine = input.machine;
  const ready = !!machine?.canStart && machine.deviceAuthorized;
  const canManagePresenters = !!machine?.paired && machine.deviceAuthorized && machine.membershipStatus === "SUPPORTED"
    && !["UPDATE_REQUIRED", "OFFLINE", "ERROR"].includes(machine.state);
  return {
    accountId: machine?.sessionActive && machine.activeAccountId ? machine.activeAccountId : input.accountId,
    status: customerLiveStatus(machine),
    sessionActive: !!machine?.sessionActive,
    canStart: ready && !machine?.sessionActive && !input.busy && input.accountReady !== false && input.imageReady && input.microphoneReady && input.productsReady,
    canManagePresenters,
    canLoadPresenterImages: canManagePresenters && !input.busy && !machine?.sessionActive,
    paused: machine?.state === "PAUSED",
    currentProductId: machine?.sessionActive ? machine.currentProductId ?? null : null,
    sessionStartedAt: machine?.sessionActive ? machine.sessionStartedAt ?? null : null,
    readiness: {
      image: input.imageReady ? "READY" : "WAITING",
      audio: input.microphoneReady ? "READY" : "WAITING",
      brain: ready ? "READY" : "UNAVAILABLE",
      products: input.productsReady ? "READY" : "WAITING",
      connection: ready ? "READY" : "UNAVAILABLE",
      backupVoice: "UNAVAILABLE",
    },
  };
}

export function customerMetric(value: number | null | undefined, suffix = ""): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? `${new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(value)}${suffix}`
    : "ยังไม่มีข้อมูล";
}

export function readinessLabel(state: ReadinessState): string {
  return state === "READY" ? "พร้อม" : state === "WAITING" ? "ต้องเลือกก่อน" : "รอความพร้อม";
}
