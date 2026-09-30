import {
  ActionQueue, CommentEngine, ProductBrain,
  type IncomingLiveComment, type LiveAction, type LiveBrainDecision, type LiveBrainProvider,
  type SellerRules,
} from "./domain";
import { LiveSessionController } from "./session-controller";

/** Network/worker boundary. A real voice adapter must supply audio before LIVE can be enabled. */
export interface VoiceProvider {
  streamText(text: string, utteranceId: string, signal: AbortSignal): AsyncIterable<Uint8Array>;
  interrupt(): Promise<void>;
  cancel(utteranceId: string): Promise<void>;
}

/** Audio is forwarded as chunks; the pipeline never renders a prerecorded full clip. */
export interface PresenterAudioPort {
  pushAudioChunk(sessionId: string, pcm16: Uint8Array): Promise<void>;
}

export type LivePipelineStep =
  | { type: "NO_ACTION" }
  | { type: "COMMENT_HANDLED"; decision: LiveBrainDecision; queued: number }
  | { type: "ACTION_HANDLED"; action: LiveAction["type"]; audioChunks: number };

/** Same queue/decision/execution path for development mocks and eventual real adapters. */
export class LivePipeline {
  private activeUtterance: string | null = null;
  private speechAbort: AbortController | null = null;

  constructor(private readonly deps: {
    controller: LiveSessionController;
    comments: CommentEngine;
    brain: LiveBrainProvider;
    products: ProductBrain;
    actions: ActionQueue;
    voice: VoiceProvider;
    presenterAudio: PresenterAudioPort;
    sellerRules?: SellerRules;
    now?: () => number;
  }) {}

  ingestComment(input: IncomingLiveComment): ReturnType<CommentEngine["ingest"]> {
    return this.deps.comments.ingest(input);
  }

  async handleNextComment(): Promise<LivePipelineStep> {
    const session = this.deps.controller.current();
    if (session?.state !== "RUNNING") return { type: "NO_ACTION" };
    const comment = this.deps.comments.next();
    if (!comment) return { type: "NO_ACTION" };
    try {
      const decision = await this.deps.brain.decide({
        comment, product: this.deps.products.current(), sellerRules: this.deps.sellerRules,
      });
      await this.deps.controller.updateContext({ lastComment: comment.text, currentResponse: decision.reply });
      let queued = 0;
      for (const suggestion of decision.suggestedActions) {
        const accepted = this.deps.actions.enqueue({
          idempotencyKey: `${comment.commentId}:${suggestion.type}`,
          type: suggestion.type,
          priority: suggestion.priority,
          payload: suggestion.type === "SPEAK" ? { text: decision.reply } : undefined,
        });
        if (!accepted) throw new Error("live_action_queue_rejected");
        queued += 1;
      }
      return { type: "COMMENT_HANDLED", decision, queued };
    } catch (cause) {
      await this.deps.controller.requireRecovery();
      throw cause;
    }
  }

  async handleNextAction(): Promise<LivePipelineStep> {
    const session = this.deps.controller.current();
    if (!session) throw new Error("session_not_started");
    const action = this.deps.actions.dequeue((candidate) => session.state === "RUNNING"
      || candidate.type === "STOP"
      || (session.state === "PAUSED" && candidate.type === "RESUME"));
    if (!action) return { type: "NO_ACTION" };

    if (action.type === "STOP" || action.type === "PAUSE") {
      await this.interruptSpeech();
      if (action.type === "STOP") await this.deps.controller.stop();
      else await this.deps.controller.pause();
      return { type: "ACTION_HANDLED", action: action.type, audioChunks: 0 };
    }
    if (action.type === "RESUME") {
      await this.deps.controller.resume();
      return { type: "ACTION_HANDLED", action: action.type, audioChunks: 0 };
    }
    if (session.state !== "RUNNING") return { type: "NO_ACTION" };
    if (action.type === "SWITCH_PRODUCT") {
      const productId = action.payload?.productId;
      if (typeof productId !== "string" || !this.deps.products.select(productId)) throw new Error("product_not_selected");
      await this.deps.controller.updateContext({ productId });
      return { type: "ACTION_HANDLED", action: action.type, audioChunks: 0 };
    }
    if (action.type === "SHOW_PRODUCT") {
      // The real product-pin integration is deliberately absent in this phase.
      this.deps.controller.events.record("PRODUCT_SHOWN", (this.deps.now ?? Date.now)());
      return { type: "ACTION_HANDLED", action: action.type, audioChunks: 0 };
    }

    const text = action.payload?.text;
    if (typeof text !== "string" || !text.trim()) throw new Error("speech_text_required");
    const abort = new AbortController();
    this.speechAbort = abort;
    this.activeUtterance = action.idempotencyKey;
    let audioChunks = 0;
    try {
      for await (const chunk of this.deps.voice.streamText(text, action.idempotencyKey, abort.signal)) {
        if (abort.signal.aborted) break;
        await this.deps.presenterAudio.pushAudioChunk(session.id, chunk);
        audioChunks += 1;
      }
      if (!abort.signal.aborted && audioChunks > 0) {
        this.deps.controller.events.record("SPEAKING", (this.deps.now ?? Date.now)());
      }
    } catch (cause) {
      await this.deps.controller.requireRecovery();
      throw cause;
    } finally {
      if (this.speechAbort === abort) this.speechAbort = null;
      if (this.activeUtterance === action.idempotencyKey) this.activeUtterance = null;
    }
    return { type: "ACTION_HANDLED", action: action.type, audioChunks };
  }

  async interruptSpeech(): Promise<void> {
    this.speechAbort?.abort();
    const utterance = this.activeUtterance;
    await this.deps.voice.interrupt();
    if (utterance) await this.deps.voice.cancel(utterance);
  }
}
