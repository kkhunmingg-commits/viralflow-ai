export interface IncomingLiveComment {
  commentId: string;
  viewerId: string;
  text: string;
  createdAtMs: number;
}

export interface LiveComment extends IncomingLiveComment {
  normalizedText: string;
  language: string;
  priority: number;
}

export interface LanguageDetector {
  detect(text: string): string;
}

export type CommentRejectReason = "INVALID" | "DUPLICATE" | "COOLDOWN" | "SPAM" | "QUEUE_FULL";
export type CommentIngestResult =
  | { accepted: true; comment: LiveComment }
  | { accepted: false; reason: CommentRejectReason };

export interface CommentEngineOptions {
  now?: () => number;
  languageDetector?: LanguageDetector;
  cooldownMs?: number;
  dedupeWindowMs?: number;
  maxQueue?: number;
  maxSeen?: number;
}

const defaultLanguageDetector: LanguageDetector = {
  detect(text) {
    if (/[\u0E00-\u0E7F]/u.test(text)) return "th";
    if (/[A-Za-z]/u.test(text)) return "en";
    return "und";
  },
};

export function liveCommentPriority(text: string): number {
  if (/(อันตราย|หลอกลวง|รายงาน|คุกคาม|unsafe|scam|report|harassment)/iu.test(text)) return 100;
  if (/(ราคา|เท่าไหร่|กี่บาท|price|cost|ส่งฟรี|shipping)/iu.test(text)
    || /[?？]/u.test(text) || /(ไหม|มั้ย|หรือเปล่า|how|what|where)/iu.test(text)) return 80;
  if (/(ซื้อ|สั่ง|ตะกร้า|buy|order|checkout)/iu.test(text)) return 70;
  if (/(สวัสดี|หวัดดี|hello|hi\b)/iu.test(text)) return 50;
  return 30;
}

function isSpam(text: string): boolean {
  return /(?:https?:\/\/|www\.|\b(?:t\.me|bit\.ly)\/)/iu.test(text)
    || /(.)\1{9,}/u.test(text)
    || (text.length > 30 && new Set(text.replace(/\s/gu, "")).size < 3);
}

/** Bounded, in-memory intake for normalized provider comments. No TikTok access occurs here. */
export class CommentEngine {
  private readonly now: () => number;
  private readonly detector: LanguageDetector;
  private readonly cooldownMs: number;
  private readonly dedupeWindowMs: number;
  private readonly maxQueue: number;
  private readonly maxSeen: number;
  private readonly seen = new Map<string, number>();
  private readonly viewerLastAccepted = new Map<string, number>();
  private queue: LiveComment[] = [];

  constructor(options: CommentEngineOptions = {}) {
    this.now = options.now ?? Date.now;
    this.detector = options.languageDetector ?? defaultLanguageDetector;
    this.cooldownMs = Math.max(0, options.cooldownMs ?? 3_000);
    this.dedupeWindowMs = Math.max(1_000, options.dedupeWindowMs ?? 5 * 60_000);
    this.maxQueue = Math.max(1, options.maxQueue ?? 100);
    this.maxSeen = Math.max(this.maxQueue * 2, options.maxSeen ?? 2_000);
  }

  get size(): number { return this.queue.length; }

  ingest(input: IncomingLiveComment): CommentIngestResult {
    const now = this.now();
    this.prune(now);
    const text = input.text?.replace(/\s+/gu, " ").trim();
    if (!input.commentId?.trim() || !input.viewerId?.trim() || !text || text.length > 300
      || !Number.isFinite(input.createdAtMs)) return { accepted: false, reason: "INVALID" };
    const signature = `${input.viewerId}\u0000${text.toLocaleLowerCase()}`;
    if (this.seen.has(`id:${input.commentId}`) || this.seen.has(`text:${signature}`)) {
      return { accepted: false, reason: "DUPLICATE" };
    }
    if (isSpam(text)) return { accepted: false, reason: "SPAM" };
    if (now - (this.viewerLastAccepted.get(input.viewerId) ?? -Infinity) < this.cooldownMs) {
      return { accepted: false, reason: "COOLDOWN" };
    }
    const comment: LiveComment = {
      ...input,
      text,
      normalizedText: text.toLocaleLowerCase(),
      language: this.detector.detect(text),
      priority: liveCommentPriority(text),
    };
    if (this.queue.length >= this.maxQueue) {
      let weakest = 0;
      for (let index = 1; index < this.queue.length; index++) {
        if (this.queue[index].priority < this.queue[weakest].priority) weakest = index;
      }
      if (comment.priority <= this.queue[weakest].priority) return { accepted: false, reason: "QUEUE_FULL" };
      this.queue.splice(weakest, 1);
    }
    this.queue.push(comment);
    this.viewerLastAccepted.set(input.viewerId, now);
    this.seen.set(`id:${input.commentId}`, now);
    this.seen.set(`text:${signature}`, now);
    this.prune(now);
    return { accepted: true, comment };
  }

  next(): LiveComment | null {
    if (!this.queue.length) return null;
    let best = 0;
    for (let index = 1; index < this.queue.length; index++) {
      const candidate = this.queue[index];
      const current = this.queue[best];
      if (candidate.priority > current.priority
        || (candidate.priority === current.priority && candidate.createdAtMs < current.createdAtMs)) best = index;
    }
    return this.queue.splice(best, 1)[0];
  }

  clear(): void { this.queue = []; }

  private prune(now: number): void {
    for (const [key, seenAt] of this.seen) {
      if (now - seenAt >= this.dedupeWindowMs) this.seen.delete(key);
    }
    for (const [viewer, seenAt] of this.viewerLastAccepted) {
      if (now - seenAt >= this.cooldownMs) this.viewerLastAccepted.delete(viewer);
    }
    while (this.seen.size > this.maxSeen) this.seen.delete(this.seen.keys().next().value!);
  }
}
