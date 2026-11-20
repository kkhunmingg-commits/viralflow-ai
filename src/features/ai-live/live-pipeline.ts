import {
  ActionQueue, CommentEngine, ProductBrain,
  type IncomingLiveComment, type LiveAction, type LiveBrainDecision, type LiveBrainProvider,
  type SellerRules,
} from "./domain";
import { LiveSessionController } from "./session-controller";
import { LiveSpeechScheduler, type LiveSpeechRequest, type SpeechGesturePort } from "./speech-scheduler";
import { SafetyVoiceBuffer } from "./safety-voice-buffer";
import { LivePolicyGuard, type LivePolicyInput } from "./live-policy";
import { liveWaitTick } from "./live-timeout";

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
  | { type: "ACTION_HANDLED"; action: LiveAction["type"]; audioChunks: number }
  | { type: "SAFETY_BUFFER_HANDLED"; audioChunks: number }
  | { type: "POLICY_BLOCKED" };

/** Same queue/decision/execution path for development mocks and eventual real adapters. */
export class LivePipeline {
  readonly speech: LiveSpeechScheduler;

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
    serviceTimeoutMs?: number;
    safetyVoice?: SafetyVoiceBuffer;
    gestures?: SpeechGesturePort;
    policy?: LivePolicyGuard;
    policyIdentity?: Omit<LivePolicyInput, "text" | "productId">;
  }) {
    this.speech = new LiveSpeechScheduler({ voice: deps.voice, presenterAudio: deps.presenterAudio,
      buffer: deps.safetyVoice, gestures: deps.gestures, timeoutMs: deps.serviceTimeoutMs, now: deps.now });
  }

  enqueueSpeech(request: LiveSpeechRequest): boolean {
    if (!this.policyAllows(request.text, request.productId)) return false;
    return this.speech.enqueue(request);
  }

  private policyAllows(text: string, productId: string | null): boolean {
    return !this.deps.policy || this.deps.policy.evaluate({ text, productId,
      representsRealPerson: false, identityConsentConfirmed: false, impersonationClaim: false,
      ...this.deps.policyIdentity }).allowed;
  }

  ingestComment(input: IncomingLiveComment): ReturnType<CommentEngine["ingest"]> {
    return this.deps.comments.ingest(input);
  }

  async handleNextComment(): Promise<LivePipelineStep> {
    const session = this.deps.controller.current();
    if (session?.state !== "RUNNING") return { type: "NO_ACTION" };
    const comment = this.deps.comments.next();
    if (!comment) return { type: "NO_ACTION" };
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.speech.preempt(comment.priority);
      const pending = Promise.race([
        this.deps.brain.decide({ comment, product: this.deps.products.current(), sellerRules: this.deps.sellerRules, signal: abort.signal }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error("live_brain_timeout")); }, this.deps.serviceTimeoutMs ?? 10_000); }),
      ]);
      let decision: LiveBrainDecision;
      if (!this.deps.safetyVoice) decision = await pending;
      else {
        let continuation = false;
        while (true) {
          const tick = await liveWaitTick(pending, 500);
          if (tick.ready) { decision = tick.value; break; }
          if (this.deps.controller.current()?.state !== "RUNNING") { abort.abort(); return { type: "NO_ACTION" }; }
          const fallback = await this.speech.playSafety(session.id, session.currentProductId, "FILLER", continuation);
          if (fallback.audioChunks) continuation = true;
        }
      }
      if (this.deps.controller.current()?.state !== "RUNNING") return { type: "NO_ACTION" };
      if (!this.policyAllows(decision.reply, session.currentProductId)) {
        this.deps.controller.events.record("BLOCKED", (this.deps.now ?? Date.now)());
        return { type: "POLICY_BLOCKED" };
      }
      await this.deps.controller.updateContext({ lastComment: comment.text, currentResponse: decision.reply });
      let queued = 0;
      for (const suggestion of decision.suggestedActions) {
        const accepted = this.deps.actions.enqueue({
          idempotencyKey: `${comment.commentId}:${suggestion.type}`,
          type: suggestion.type,
          priority: suggestion.priority,
          payload: suggestion.type === "SPEAK" ? { text: decision.reply, intent: decision.intent, speechSource: "COMMENT" } : undefined,
        });
        if (!accepted) throw new Error("live_action_queue_rejected");
        queued += 1;
      }
      return { type: "COMMENT_HANDLED", decision, queued };
    } catch (cause) {
      if (this.deps.controller.current()?.state !== "RUNNING") return { type: "NO_ACTION" };
      if (this.deps.safetyVoice) {
        const fallback = await this.speech.playSafety(session.id, session.currentProductId);
        if (fallback.audioChunks) return { type: "SAFETY_BUFFER_HANDLED", audioChunks: fallback.audioChunks };
      }
      await this.deps.controller.requireRecovery();
      throw cause;
    } finally { if (timer) clearTimeout(timer); }
  }

  async handleNextAction(): Promise<LivePipelineStep> {
    const session = this.deps.controller.current();
    if (!session) throw new Error("session_not_started");
    const action = this.deps.actions.dequeue((candidate) => (session.state === "RUNNING" && (candidate.type !== "SPEAK" || !this.speech.busy))
      || candidate.type === "STOP"
      || (session.state === "PAUSED" && candidate.type === "RESUME"));
    if (!action) {
      if (session.state !== "RUNNING") return { type: "NO_ACTION" };
      let resumed;
      try { resumed = await this.speech.runNext(session.id); }
      catch (error) { await this.deps.controller.requireRecovery(); throw error; }
      if (resumed.status === "IDLE") return { type: "NO_ACTION" };
      return { type: "ACTION_HANDLED", action: "SPEAK", audioChunks: resumed.audioChunks };
    }

    if (action.type === "STOP" || action.type === "PAUSE") {
      if (action.type === "STOP") {
        let speechError: unknown;
        try { await this.speech.stop(); } catch (error) { speechError = error; }
        const stopped = await this.deps.controller.stop();
        if (stopped.state === "STOPPED") this.speech.confirmStopped();
        else if (speechError) throw speechError;
      } else {
        try { await this.speech.pause(); await this.deps.controller.pause(); }
        catch (error) { await this.deps.controller.requireRecovery(); throw error; }
      }
      return { type: "ACTION_HANDLED", action: action.type, audioChunks: 0 };
    }
    if (action.type === "RESUME") {
      await this.deps.controller.resume();
      this.speech.resume();
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
    if (!this.policyAllows(text, session.currentProductId)) return { type: "POLICY_BLOCKED" };
    const source = action.payload?.speechSource;
    const intent = action.payload?.intent;
    const allowedIntents: LiveSpeechRequest["intent"][] = ["BUY", "PRICE", "PRODUCT", "GREETING", "GENERAL", "SAFETY", "FILLER"];
    if (!this.enqueueSpeech({ id: action.idempotencyKey, text, priority: action.priority,
      source: source === "SCRIPT" || source === "MANUAL" ? source : "COMMENT", productId: session.currentProductId,
      intent: typeof intent === "string" && allowedIntents.includes(intent as LiveSpeechRequest["intent"]) ? intent as LiveSpeechRequest["intent"] : "GENERAL" })) {
      throw new Error("live_speech_queue_rejected");
    }
    let audioChunks: number;
    try {
      const result = await this.speech.runNext(session.id);
      audioChunks = result.audioChunks;
      if (audioChunks > 0 && this.deps.controller.current()?.state === "RUNNING") {
        this.deps.controller.events.record("SPEAKING", (this.deps.now ?? Date.now)());
      }
    } catch (cause) {
      await this.deps.controller.requireRecovery();
      throw cause;
    }
    return { type: "ACTION_HANDLED", action: action.type, audioChunks };
  }

  async interruptSpeech(): Promise<void> {
    await this.speech.interrupt();
  }
}
