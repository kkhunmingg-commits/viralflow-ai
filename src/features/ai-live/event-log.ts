export type LiveEventKind =
  | "SESSION_STARTED" | "SESSION_PAUSED" | "SESSION_RESUMED" | "SESSION_STOPPED"
  | "COMMENT_RECEIVED" | "REPLY_READY" | "SPEAKING"
  | "PRODUCT_CHANGED" | "PRODUCT_SHOWN" | "RECOVERY_REQUIRED" | "BLOCKED";

const eventText: Record<LiveEventKind, string> = {
  SESSION_STARTED: "เริ่มเตรียมการแสดงสด",
  SESSION_PAUSED: "หยุดชั่วคราว",
  SESSION_RESUMED: "ทำงานต่อ",
  SESSION_STOPPED: "หยุดการแสดงสด",
  COMMENT_RECEIVED: "มีความคิดเห็นใหม่",
  REPLY_READY: "เตรียมคำตอบแล้ว",
  SPEAKING: "กำลังพูด",
  PRODUCT_CHANGED: "เปลี่ยนสินค้า",
  PRODUCT_SHOWN: "กำลังแนะนำสินค้า",
  RECOVERY_REQUIRED: "ต้องตรวจสอบก่อนเริ่มต่อ",
  BLOCKED: "ต้องการการดำเนินการ",
};

export interface LiveEvent {
  sequence: number;
  at: number;
  kind: LiveEventKind;
  text: string;
}

export class LiveEventLog {
  private events: LiveEvent[] = [];
  private nextSequence = 1;

  constructor(private readonly capacity = 100) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("invalid_event_capacity");
  }

  record(kind: LiveEventKind, at: number): LiveEvent {
    const event = { sequence: this.nextSequence++, at, kind, text: eventText[kind] };
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.shift();
    return event;
  }

  recent(limit = 10): LiveEvent[] {
    return this.events.slice(-Math.max(0, limit));
  }

  get size(): number { return this.events.length; }
}
