import type { LocalMachineView, LocalRoomCapacity } from "./local-contract";
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
  capacity: LocalRoomCapacity;
  rooms: Array<{ accountId: string; status: string; sessionActive: boolean; paused: boolean; currentProductId: string | null; sessionStartedAt: number | null }>;
}

/** A room on another account never becomes the selected account's active room. */
export function machineForAccount(machine: LocalMachineView | null, accountId: string): LocalMachineView | null {
  if (!machine) return null;
  const room = machine.rooms?.find((item) => item.accountId === accountId);
  if (room) return { ...machine, state: room.state === "STOPPED" ? "READY" : room.state,
    sessionActive: room.state !== "STOPPED", activeAccountId: room.accountId,
    currentProductId: room.currentProductId ?? undefined, sessionStartedAt: room.sessionStartedAt ?? undefined,
    customerStream: room.customerStream };
  if ((machine.rooms?.length && !room) || (machine.activeAccountId && machine.activeAccountId !== accountId)) return {
    ...machine, state: ["BUSY", "PAUSED", "STOPPING"].includes(machine.state) ? "READY" : machine.state,
    sessionActive: false, activeAccountId: undefined, currentProductId: undefined, sessionStartedAt: undefined,
    customerStream: undefined,
  };
  return machine;
}

/** Presence/configuration alone never proves speech, transport, or live sales. */
export function customerRoomRuntime(input: {
  accountId: string; machine: LocalMachineView | null; imageReady: boolean;
  microphoneReady: boolean; productsReady: boolean; busy: boolean; accountReady?: boolean;
}): CustomerRoomRuntime {
  const machine = machineForAccount(input.machine, input.accountId);
  const ready = !!machine?.canStart && machine.deviceAuthorized && machine.capacity?.status === "VERIFIED"
    && machine.capacity.canStartAnotherRoom;
  const canManagePresenters = !!machine?.paired && machine.deviceAuthorized && machine.membershipStatus === "SUPPORTED"
    && !["UPDATE_REQUIRED", "OFFLINE", "ERROR"].includes(machine.state);
  return {
    accountId: input.accountId,
    status: customerLiveStatus(machine),
    sessionActive: !!machine?.sessionActive,
    canStart: ready && !machine?.sessionActive && !input.busy && input.accountReady !== false && input.imageReady && input.microphoneReady && input.productsReady,
    canManagePresenters,
    canLoadPresenterImages: canManagePresenters && !input.busy && !machine?.sessionActive,
    paused: machine?.state === "PAUSED",
    currentProductId: machine?.sessionActive ? machine.currentProductId ?? null : null,
    sessionStartedAt: machine?.sessionActive ? machine.sessionStartedAt ?? null : null,
    capacity: machine?.capacity ?? { status: "UNVERIFIED_CAPACITY", maximumRooms: null, activeRooms: 0, canStartAnotherRoom: false },
    rooms: input.machine?.rooms?.map((room) => ({ accountId: room.accountId,
      status: customerLiveStatus(machineForAccount(input.machine, room.accountId)), sessionActive: room.state !== "STOPPED",
      paused: room.state === "PAUSED", currentProductId: room.currentProductId, sessionStartedAt: room.sessionStartedAt })) ?? [],
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
