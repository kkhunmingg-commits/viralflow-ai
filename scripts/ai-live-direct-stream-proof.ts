/** Explicit DEV-only continuous proof using the same domain and real SAPI boundaries
 * as ai-live-comment-proof.ts. Worker secrets and diagnostic IDs stay local. */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ActionQueue, CommentEngine, ProductBrain, RuleBasedLiveBrain, type LiveProduct } from '../src/features/ai-live/domain';
import { devFallbackEnabled } from '../src/features/ai-live/dev-mode';
import { LivePipeline, type VoiceProvider } from '../src/features/ai-live/live-pipeline';
import { LiveSessionController, type LiveSessionSnapshot, type PresenterRuntimePort } from '../src/features/ai-live/session-controller';

type Metrics = {
  status?: string; resources_released?: boolean; frames_generated?: number; queue_depth?: number;
  encoder?: { frames_encoded?: number; frames_written?: number; audio_buffer_ms?: number; audio_latency_ms?: number;
    transport?: { status?: string }; [key: string]: unknown };
  [key: string]: unknown;
};

async function main() {
  if (process.env.AI_LIVE_DIRECT_STREAM_PROOF !== '1' || !devFallbackEnabled()) throw new Error('DIRECT_STREAM_PROOF_DISABLED');
  if (!process.argv[2] || !process.argv[3]) throw new Error('CONTEXT_AND_OUTPUT_PATH_REQUIRED');
  const durationSeconds = Number(process.env.AI_LIVE_DIRECT_STREAM_DURATION_SECONDS ?? '600');
  if (!Number.isInteger(durationSeconds) || durationSeconds < 12 || durationSeconds > 3600) throw new Error('INVALID_PROOF_DURATION');
  const context = JSON.parse(await readFile(process.argv[2], 'utf8')) as {
    ownerId: string; accountId: string; productSource: 'EXISTING_RECORD' | 'EXISTING_TEST_FIXTURE'; products: LiveProduct[];
  };
  if (!context.ownerId || !context.accountId || !context.products.length
    || !['EXISTING_RECORD', 'EXISTING_TEST_FIXTURE'].includes(context.productSource)) throw new Error('PRODUCT_CONTEXT_REQUIRED');
  const origin = new URL(process.env.AI_LIVE_PROOF_WORKER_ORIGIN ?? '');
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.pathname !== '/'
    || origin.username || origin.password || origin.search || origin.hash) throw new Error('LOCAL_WORKER_REQUIRED');
  const token = process.env.AI_LIVE_WORKER_TOKEN;
  const referenceId = process.env.AI_LIVE_PROOF_REFERENCE_ID;
  if (!token || token.length < 32 || !referenceId) throw new Error('PROOF_WORKER_CONFIG_REQUIRED');
  async function request(path: string, body?: BodyInit, media = 'application/json') {
    const result = await fetch(new URL(path, origin), { method: body === undefined ? 'GET' : 'POST', body,
      headers: { Authorization: `Bearer ${token}`, 'X-ViralFlow-Owner-Id': context.ownerId, 'Content-Type': media },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!result.ok) throw new Error(`PROOF_WORKER_HTTP_${result.status}`);
    return result.json();
  }
  const sessions = new Map<string, string>();
  async function metrics(id: string): Promise<Metrics> {
    const actual = sessions.get(id);
    if (!actual) throw new Error('SESSION_NOT_STARTED');
    return request(`/sessions/${actual}/metrics`);
  }
  const runtime: PresenterRuntimePort = {
    kind: 'dev_fallback',
    async health() { return (await request('/health')).ready ? 'READY' : 'WORKER_UNAVAILABLE'; },
    async start(id, reference) {
      const result = await request('/sessions', JSON.stringify({ reference_id: reference, target_fps: 2 }));
      sessions.set(id, result.session_id);
      console.log(JSON.stringify({ event: 'STREAM_SESSION_START', mode: 'DEV_PROOF_ONLY', sessionId: result.session_id }));
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const current = await metrics(id);
        if (current.status === 'RUNNING') return;
        if (current.status === 'FAILED') throw new Error('REAL_PRESENTER_FAILED');
        await delay(250);
      }
      throw new Error('REAL_PRESENTER_START_TIMEOUT');
    },
    async pause() { throw new Error('PROOF_PAUSE_NOT_SUPPORTED'); },
    async resume() { throw new Error('PROOF_RESUME_NOT_SUPPORTED'); },
    async stop(id) {
      const actual = sessions.get(id);
      if (!actual) return;
      await request(`/sessions/${actual}/stop`, '');
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const current = await metrics(id);
        if (current.resources_released && current.status === 'STOPPED') return;
        await delay(500);
      }
      throw new Error('REAL_PRESENTER_STOP_TIMEOUT');
    },
  };
  const snapshots = new Map<string, LiveSessionSnapshot>();
  const controller = new LiveSessionController(runtime, {
    load: async (id) => snapshots.get(id) ?? null,
    save: async (snapshot) => { snapshots.set(snapshot.id, structuredClone(snapshot)); },
  });
  let activeVoice: ReturnType<typeof spawn> | null = null;
  let speechCalls = 0;
  let audioBytes = 0;
  let audioDeliveredBytes = 0;
  let audioChunks = 0;
  let audioRetries = 0;
  let maxAudioBufferMs = 0;
  const voice: VoiceProvider = {
    async *streamText(text, _utterance, signal) {
      if (signal.aborted) return;
      speechCalls++;
      const child = spawn(process.env.AI_LIVE_PROOF_PYTHON ?? 'python', [resolve('workers/ai-live/offline_voice.py')], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: process.env,
      });
      activeVoice = child;
      let errorOutput = '';
      child.stderr.on('data', (chunk) => { errorOutput = (errorOutput + chunk.toString()).slice(-4096); });
      const completed = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      const cancel = () => { child.kill(); };
      signal.addEventListener('abort', cancel, { once: true });
      child.stdin.end(JSON.stringify({ text }), 'utf8');
      let pending = Buffer.alloc(0);
      try {
        for await (const input of child.stdout) {
          pending = Buffer.concat([pending, input]);
          while (pending.length >= 32000 && !signal.aborted) {
            audioBytes += 32000;
            yield new Uint8Array(pending.subarray(0, 32000));
            pending = pending.subarray(32000);
          }
        }
        const exit = await completed;
        if (!signal.aborted && exit !== 0) throw new Error(errorOutput ? 'OFFLINE_VOICE_FAILED' : 'OFFLINE_VOICE_EXITED');
        if (!signal.aborted && pending.length) {
          if (pending.length % 2) throw new Error('INVALID_PCM16');
          audioBytes += pending.length;
          yield new Uint8Array(pending);
        }
      } finally {
        signal.removeEventListener('abort', cancel);
        if (activeVoice === child) activeVoice = null;
        if (child.exitCode === null) child.kill();
      }
    },
    async interrupt() { activeVoice?.kill(); },
    async cancel() { activeVoice?.kill(); },
  };
  const comments = new CommentEngine({ cooldownMs: 0, maxQueue: 5, maxSeen: 32 });
  const actions = new ActionQueue({ maxSize: 5, maxSeen: 32 });
  const pipeline = new LivePipeline({ controller, comments, brain: new RuleBasedLiveBrain(),
    products: new ProductBrain(context.products), actions, voice,
    presenterAudio: { async pushAudioChunk(id, pcm) {
      const actual = sessions.get(id);
      if (!actual) throw new Error('SESSION_NOT_STARTED');
      const deadline = Date.now() + 30_000;
      while (!stopping) {
        const current = await metrics(id);
        const buffered = current.encoder?.audio_buffer_ms ?? current.encoder?.audio_latency_ms;
        if (typeof buffered === 'number' && Number.isFinite(buffered)) maxAudioBufferMs = Math.max(maxAudioBufferMs, buffered);
        if (current.status !== 'RUNNING') throw new Error('AUDIO_SESSION_NOT_RUNNING');
        if (Date.now() >= deadline) throw new Error('ENCODER_AUDIO_BUFFER_STUCK');
        // Voice follows its own continuous timeline, independent of the neural queue.
        if (typeof buffered === 'number' && buffered >= 7000) { await delay(100); continue; }
        try {
          await request(`/sessions/${actual}/audio`, pcm as Uint8Array<ArrayBuffer>, 'application/octet-stream');
          audioDeliveredBytes += pcm.byteLength;
          audioChunks++;
          return;
        } catch (error) {
          // Only 429 means this exact chunk was not accepted. Never replay accepted audio.
          if (!(error instanceof Error) || error.message !== 'PROOF_WORKER_HTTP_429') throw error;
          audioRetries++;
          await delay(100);
        }
      }
    } },
  });
  let stopping = false;
  let pipelineError: unknown = null;
  let pump: Promise<void> | null = null;
  let sessionId: string | null = null;
  let measuredStartedAt = 0;
  let measuredEndedAt = 0;
  let commentsAccepted = 0;
  let duplicatesRejected = 0;
  let commentsHandled = 0;
  let actionsHandled = 0;
  let maxCommentQueue = 0;
  let maxActionQueue = 0;
  let maxPresenterQueue = 0;
  let resourcesReleased = false;
  let failure: string | null = null;
  const samples: { elapsedMs: number; metrics: Metrics }[] = [];
  let beforeStop: Metrics | null = null;
  let afterStop: Metrics | null = null;
  const fixtureTexts = ['สินค้านี้ใช้ยังไง', 'สินค้านี้ราคาเท่าไหร่', 'สินค้านี้มีข้อดีอะไร',
    'สินค้านี้เหมาะกับใคร', 'สินค้านี้ใช้งานยากไหม', 'ช่วยแนะนำสินค้านี้หน่อย'];
  function ingestFixture(index: number) {
    const input = { commentId: `direct-proof-comment-${index}`, viewerId: 'simulated-viewer',
      text: `${fixtureTexts[index % fixtureTexts.length]} รอบ ${index + 1}`, createdAtMs: Date.now() };
    const accepted = pipeline.ingestComment(input);
    const duplicate = pipeline.ingestComment(input);
    if (!accepted.accepted || duplicate.accepted) throw new Error('COMMENT_DEDUPE_OR_CAPACITY_FAILED');
    commentsAccepted++;
    duplicatesRejected++;
    maxCommentQueue = Math.max(maxCommentQueue, comments.size);
  }
  function requireHealthy(current: Metrics) {
    if (pipelineError) throw pipelineError;
    if (current.status !== 'RUNNING') throw new Error('REAL_STREAM_SESSION_FAILED');
    if (current.encoder?.transport?.status === 'FAILED') throw new Error('DIRECT_TRANSPORT_FAILED');
    maxPresenterQueue = Math.max(maxPresenterQueue, current.queue_depth ?? 0);
  }
  try {
    const session = await controller.start({ ownerId: context.ownerId, tiktokAccountId: context.accountId,
      productIds: context.products.map((product) => product.id), presenterReferenceId: referenceId });
    sessionId = session.id;
    if (session.state !== 'RUNNING') throw new Error('REAL_SESSION_NOT_RUNNING');
    pump = (async () => {
      try {
        while (!stopping) {
          if (comments.size) {
            const step = await pipeline.handleNextComment();
            if (step.type === 'COMMENT_HANDLED') commentsHandled++;
            maxActionQueue = Math.max(maxActionQueue, actions.size);
          }
          if (actions.size) {
            const step = await pipeline.handleNextAction();
            if (step.type === 'ACTION_HANDLED') actionsHandled++;
          } else await delay(100);
        }
      } catch (error) { if (!stopping) pipelineError = error; }
    })();
    ingestFixture(0); // Real Thai speech supplies the first genuine generated presenter frame.
    const warmupDeadline = Date.now() + 300_000;
    while (Date.now() < warmupDeadline) {
      const current = await metrics(sessionId);
      requireHealthy(current);
      if ((current.frames_generated ?? 0) > 0 && (current.encoder?.frames_encoded ?? current.encoder?.frames_written ?? 0) > 0
        && current.encoder?.transport?.status === 'LIVE') { measuredStartedAt = Date.now(); break; }
      await delay(500);
    }
    if (!measuredStartedAt) throw new Error('FIRST_REAL_FRAME_AND_TRANSPORT_TIMEOUT');
    console.log(JSON.stringify({ event: 'STREAM_MEASUREMENT_START', mode: 'DEV_PROOF_ONLY', durationSeconds }));
    let nextCommentAt = measuredStartedAt;
    let nextSampleAt = measuredStartedAt;
    const sampleIntervalMs = Math.max(5000, durationSeconds * 1000 / 120);
    const measuredDeadline = measuredStartedAt + durationSeconds * 1000;
    let fixtureIndex = 1;
    while (Date.now() < measuredDeadline) {
      if (pipelineError) throw pipelineError;
      const now = Date.now();
      if (now >= nextCommentAt) {
        ingestFixture(fixtureIndex++);
        nextCommentAt = now + 12_000; // A delayed poll never creates a burst of fixture comments.
      }
      if (now >= nextSampleAt) {
        const current = await metrics(sessionId);
        requireHealthy(current);
        samples.push({ elapsedMs: Date.now() - measuredStartedAt, metrics: current });
        if (samples.length > 121) samples.shift();
        console.log(JSON.stringify({ event: 'STREAM_PROOF_SAMPLE', elapsedMs: Date.now() - measuredStartedAt,
          realFrames: current.frames_generated, encoderFrames: current.encoder?.frames_encoded,
          transport: current.encoder?.transport?.status, commentsAccepted, speechCalls }));
        nextSampleAt = Date.now() + sampleIntervalMs;
      }
      await delay(100);
    }
    measuredEndedAt = Date.now();
    beforeStop = await metrics(sessionId);
    requireHealthy(beforeStop);
    samples.push({ elapsedMs: measuredEndedAt - measuredStartedAt, metrics: beforeStop });
    if (samples.length > 121) samples.shift();
  } catch (error) {
    failure = error instanceof Error ? error.message : 'DIRECT_STREAM_PROOF_FAILED';
    measuredEndedAt = Date.now();
  } finally {
    stopping = true;
    await pipeline.interruptSpeech();
    if (pump) await pump;
    try {
      if (controller.current()) {
        const stopped = await controller.stop();
        if (sessionId) afterStop = await metrics(sessionId);
        resourcesReleased = stopped.state === 'STOPPED' && afterStop?.resources_released === true;
        if (!resourcesReleased) failure ??= 'REAL_SESSION_NOT_RELEASED';
      }
    } catch { failure ??= 'REAL_SESSION_STOP_FAILED'; }
    comments.clear();
    actions.clear();
    await writeFile(process.argv[3], JSON.stringify({ mode: 'DEV_PROOF_ONLY', productSource: context.productSource,
      requestedDurationSeconds: durationSeconds, measuredDurationMs: measuredStartedAt ? measuredEndedAt - measuredStartedAt : 0,
      fixtureInput: { viewerType: 'SIMULATED_VIEWER', cooldownMs: 0, commentIntervalMs: 12_000, texts: fixtureTexts },
      measurementStartedAfterRealFrameAndLiveTransport: measuredStartedAt > 0, completed: failure === null,
      failure, commentsAccepted, duplicatesRejected, duplicateCommentRejected: commentsAccepted > 0 && commentsAccepted === duplicatesRejected,
      commentsHandled, actionsHandled, speechCalls, audioBytes, audioDeliveredBytes, audioChunks, audioRetries,
      maxCommentQueue, maxActionQueue, maxPresenterQueue, maxAudioBufferMs, retainedSamples: samples.length,
      samples, events: controller.events.recent(), beforeStop, afterStop, resourcesReleased,
      commentQueueAfterStop: comments.size, actionQueueAfterStop: actions.size }, null, 2));
  }
  if (failure) throw new Error(failure);
  console.log(JSON.stringify({ event: 'DIRECT_STREAM_PROOF_COMPLETE', mode: 'DEV_PROOF_ONLY',
    measuredDurationMs: measuredEndedAt - measuredStartedAt, speechCalls, audioDeliveredBytes, resourcesReleased }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'DIRECT_STREAM_PROOF_FAILED'); process.exitCode = 1; });
