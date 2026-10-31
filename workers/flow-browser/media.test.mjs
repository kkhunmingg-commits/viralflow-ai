import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectVideo } from './media.mjs';
import { assertContained } from './core.mjs';

const require = createRequire(import.meta.url);
const run = promisify(execFile);
const testRoot = resolve(fileURLToPath(new URL('../../.runtime/tmp/', import.meta.url)));
if (process.platform === 'win32' && !/^D:\\/i.test(testRoot)) throw new Error('TEST_WORKSPACE_MUST_BE_ON_D');
let dir;
before(async () => {
  await mkdir(testRoot, { recursive: true });
  dir = await mkdtemp(join(testRoot, 'flow-media-test-'));
  const ffmpeg = require('ffmpeg-static');
  // Synthetic local media checks only; these are not Google-generation acceptance tests.
  for (const [name, size] of [['portrait', '90x160'], ['landscape', '160x90']]) {
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=black:s=${size}:d=1`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, name + '.mp4')], { windowsHide: true });
  }
  const fake = Buffer.alloc(100); fake.write('ftyp', 4, 'ascii');
  await writeFile(join(dir, 'header-only.mp4'), fake);
  await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-t', '1', '-c:a', 'aac', join(dir, 'audio-only.mp4')], { windowsHide: true });
});
after(async () => { if (dir) await rm(assertContained(testRoot, dir), { recursive: true, force: true }); });

test('probes a real portrait video stream and records its metadata', async () => {
  const media = await inspectVideo(join(dir, 'portrait.mp4'));
  assert.equal(media.width, 90); assert.equal(media.height, 160);
  assert.ok(media.durationSeconds > 0); assert.equal(media.hasAudio, false);
});
test('rejects an ftyp header without a playable container', async () => {
  await assert.rejects(inspectVideo(join(dir, 'header-only.mp4')), /MP4_PROBE_FAILED/);
});
test('holds a landscape result for correction instead of importing it as portrait', async () => {
  await assert.rejects(inspectVideo(join(dir, 'landscape.mp4')), /MP4_PORTRAIT_9_16_REQUIRED/);
});
test('rejects an audio-only MP4', async () => {
  await assert.rejects(inspectVideo(join(dir, 'audio-only.mp4')), /MP4_VIDEO_STREAM_REQUIRED/);
});
