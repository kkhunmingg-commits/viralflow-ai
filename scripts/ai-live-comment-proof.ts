/** Explicit DEV-only real media integration of the existing domain pipeline.
 * Worker credentials stay in this local server process; no browser receives them.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ActionQueue, CommentEngine, ProductBrain, RuleBasedLiveBrain, type LiveProduct } from '../src/features/ai-live/domain';
import { devFallbackEnabled } from '../src/features/ai-live/dev-mode';
import { LivePipeline, type VoiceProvider } from '../src/features/ai-live/live-pipeline';
import { LiveSessionController, type LiveSessionSnapshot, type PresenterRuntimePort } from '../src/features/ai-live/session-controller';

async function main() {
  if (!devFallbackEnabled()) throw new Error('DEV_FALLBACK_DISABLED');
  const context = JSON.parse(await readFile(process.argv[2], 'utf8')) as {
    ownerId: string; accountId: string; productSource: 'EXISTING_RECORD' | 'EXISTING_TEST_FIXTURE'; products: LiveProduct[];
  };
  if (!context.ownerId || !context.accountId || !context.products.length
    || !['EXISTING_RECORD', 'EXISTING_TEST_FIXTURE'].includes(context.productSource)) throw new Error('PRODUCT_CONTEXT_REQUIRED');
  const origin = new URL(process.env.AI_LIVE_PROOF_WORKER_ORIGIN ?? '');
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.pathname !== '/') throw new Error('LOCAL_WORKER_REQUIRED');
  const token = process.env.AI_LIVE_WORKER_TOKEN;
  const referenceId = process.env.AI_LIVE_PROOF_REFERENCE_ID;
  if (!token || token.length < 32 || !referenceId) throw new Error('PROOF_WORKER_CONFIG_REQUIRED');
  async function request(path: string, body?: BodyInit, media = 'application/json') {
    const result = await fetch(new URL(path, origin), {method: body === undefined ? 'GET' : 'POST', body,
      headers: {Authorization: `Bearer ${token}`, 'X-ViralFlow-Owner-Id': context.ownerId, 'Content-Type': media},
      signal: AbortSignal.timeout(20_000)});
    if (!result.ok) throw new Error(`PROOF_WORKER_HTTP_${result.status}`);
    return result.json();
  }
  const sessions = new Map<string, string>();
  async function metrics(id: string) {
    const actual = sessions.get(id);
    if (!actual) throw new Error('SESSION_NOT_STARTED');
    return request(`/sessions/${actual}/metrics`);
  }
  const runtime: PresenterRuntimePort = {
    kind: 'dev_fallback',
    async health() { return (await request('/health')).ready ? 'READY' : 'WORKER_UNAVAILABLE'; },
    async start(id, reference) {
      const result = await request('/sessions', JSON.stringify({reference_id: reference, target_fps: 2}));
      sessions.set(id, result.session_id);
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
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const result = await metrics(id);
        if (result.resources_released && result.status === 'STOPPED') return;
        await delay(250);
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
      const cancel = () => child.kill();
      signal.addEventListener('abort', cancel, {once: true});
      child.stdin.end(JSON.stringify({text}), 'utf8');
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
  const comments = new CommentEngine({cooldownMs: 0, maxQueue: 5, maxSeen: 32});
  const actions = new ActionQueue({maxSize: 5, maxSeen: 32});
  const pipeline = new LivePipeline({controller, comments, brain: new RuleBasedLiveBrain(),
    products: new ProductBrain(context.products), actions, voice,
    presenterAudio: {async pushAudioChunk(id, pcm) {
      const actual = sessions.get(id);
      if (!actual) throw new Error('SESSION_NOT_STARTED');
      const deadline = Date.now() + 60_000;
      while ((await metrics(id)).queue_depth >= 1) {
        if (Date.now() > deadline) throw new Error('AUDIO_QUEUE_STUCK');
        await delay(200);
      }
      await request(`/sessions/${actual}/audio`, pcm as Uint8Array<ArrayBuffer>, 'application/octet-stream');
    }},
  });
  try {
    const session = await controller.start({ownerId: context.ownerId, tiktokAccountId: context.accountId,
      productIds: context.products.map((product) => product.id), presenterReferenceId: referenceId});
    if (session.state !== 'RUNNING') throw new Error('REAL_SESSION_NOT_RUNNING');
    const input = {commentId: 'proof-comment-1', viewerId: 'simulated-viewer', text: 'สินค้านี้ใช้ยังไง', createdAtMs: Date.now()};
    const accepted = pipeline.ingestComment(input);
    const duplicate = pipeline.ingestComment(input);
    if (!accepted.accepted || duplicate.accepted) throw new Error('COMMENT_DEDUPE_FAILED');
    const decision = await pipeline.handleNextComment();
    while (actions.size) await pipeline.handleNextAction();
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const current = await metrics(session.id);
      if (current.frames_generated > 0 && current.queue_depth === 0 && !current.inference_active) break;
      if (current.status === 'FAILED') throw new Error('REAL_INFERENCE_FAILED');
      await delay(500);
    }
    const beforeStop = await metrics(session.id);
    if (!beforeStop.frames_generated) throw new Error('NO_REAL_FRAMES');
    if (beforeStop.status !== 'RUNNING' || beforeStop.queue_depth !== 0 || beforeStop.inference_active) {
      throw new Error('AUDIO_DRAIN_TIMEOUT');
    }
    const result = {mode: 'DEV_PROOF_ONLY', productSource: context.productSource, decision, speechCalls, audioBytes,
      realFrames: beforeStop.frames_generated, commentQueue: comments.size, actionQueue: actions.size,
      duplicateCommentRejected: !duplicate.accepted, events: controller.events.recent(), metrics: beforeStop};
    await pipeline.interruptSpeech();
    const stopped = await controller.stop();
    if (stopped.state !== 'STOPPED') throw new Error('REAL_SESSION_NOT_RELEASED');
    await writeFile(process.argv[3], JSON.stringify({...result, resourcesReleased: true}, null, 2));
    console.log(JSON.stringify({event: 'COMMENT_PROOF_COMPLETE', productSource: context.productSource, speechCalls, audioBytes, frames: beforeStop.frames_generated}));
  } finally {
    await pipeline.interruptSpeech();
    if (controller.current()) await controller.stop();
    comments.clear(); actions.clear();
  }
}
main().catch((error) => {console.error(error instanceof Error ? error.message : 'PROOF_FAILED'); process.exitCode = 1;});
