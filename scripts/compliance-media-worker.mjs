// Local subprocess only. No network, credentials, policy activation or evidence writes.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker, PSM } from 'tesseract.js';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelHashes = {
  'eng.traineddata': '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
  'tha.traineddata': '294227cc2d1292b0acb28d61d4115c88252b96d466ca90b417cf4cf0c67bf07c',
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Defense in depth: Tesseract's image loader receives Buffers, not remote URLs,
// local checked language files replace its default CDN. Deny Node HTTP too.
const denyNetwork = () => { throw new Error('LOCAL_MEDIA_NETWORK_DENIED'); };
globalThis.fetch = denyNetwork;
for (const name of ['node:http', 'node:https']) {
  const transport = (await import(name)).default;
  transport.request = denyNetwork; transport.get = denyNetwork;
}

async function main() {
  const input = path.resolve(process.argv[2]);
  const directory = path.dirname(input);
  if (path.basename(input) !== 'input.mp4' || !(await stat(input)).isFile()
    || (await stat(input)).size > 100_000_000) throw new Error('LOCAL_MEDIA_INPUT_INVALID');
  const bytes = await readFile(input);
  const langPath = process.env.COMPLIANCE_OCR_DATA_PATH;
  if (!langPath || !path.isAbsolute(langPath)) throw new Error('LOCAL_OCR_NOT_PREPARED');
  for (const [filename, hash] of Object.entries(modelHashes)) {
    if (sha(await readFile(path.join(langPath, filename))) !== hash) throw new Error('LOCAL_OCR_CHECKSUM_INVALID');
  }
  const ffmpeg = process.env.COMPLIANCE_FFMPEG_PATH;
  const ffprobe = process.env.COMPLIANCE_FFPROBE_PATH;
  if (!ffmpeg || !ffprobe || !path.isAbsolute(ffmpeg) || !path.isAbsolute(ffprobe)) throw new Error('LOCAL_DECODER_NOT_PREPARED');
  const run = (binary, args, timeout = 30_000) => exec(binary, args, {
    windowsHide: true, timeout, maxBuffer: 2_000_000, shell: false,
  });
  const probe = JSON.parse((await run(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe',
    '-show_streams', '-show_format', '-of', 'json', input])).stdout);
  const durationSeconds = Number(probe.format?.duration);
  const video = probe.streams?.find(stream => stream.codec_type === 'video');
  if (!video || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 30
    || video.width > 4096 || video.height > 4096) throw new Error('LOCAL_MEDIA_LIMIT_EXCEEDED');
  await run(ffmpeg, ['-nostdin', '-y', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', input,
    '-an', '-vf', 'fps=2,scale=1280:1280:force_original_aspect_ratio=decrease',
    '-frames:v', '60', path.join(directory, 'frame-%03d.png')]);
  const names = (await readdir(directory)).filter(name => /^frame-\d{3}\.png$/.test(name)).sort();
  if (!names.length || names.length > 60) throw new Error('LOCAL_MEDIA_FRAMES_MISSING');
  const uncertainties = ['SAMPLED_FRAMES_ONLY', 'VISUAL_SEMANTICS_UNVERIFIED'];
  let pixels = [];
  const python = process.env.COMPLIANCE_MEDIA_PYTHON;
  if (python && path.isAbsolute(python)) {
    try { pixels = JSON.parse((await run(python, [path.join(root, 'scripts/compliance-image-observations.py'), directory])).stdout); }
    catch { uncertainties.push('PIXEL_INSPECTION_UNAVAILABLE'); }
  } else uncertainties.push('PIXEL_INSPECTION_UNAVAILABLE');
  let worker;
  const frames = [], cache = new Map();
  try {
    worker = await createWorker(['eng', 'tha'], 1, { langPath, gzip: false, cacheMethod: 'none', logger: () => {} });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '150' });
    for (const [index, name] of names.entries()) {
      const image = await readFile(path.join(directory, name)), hash = sha(image);
      let ocr = cache.get(hash);
      if (!ocr) {
        const result = await worker.recognize(image);
        ocr = { text: result.data.text.trim().slice(0, 4000), confidence: result.data.confidence };
        cache.set(hash, ocr);
      }
      const pixel = pixels.find(row => row.name === name);
      const comparisonCandidate = /before[\s\S]{0,100}after|ก่อน[\s\S]{0,100}หลัง/iu.test(ocr.text)
        || pixel?.comparisonLayoutCandidate === true;
      if (ocr.text && ocr.confidence < 70) uncertainties.push('OCR_LOW_CONFIDENCE');
      if (pixel && (pixel.contrast < 8 || pixel.sharpness < 4)) uncertainties.push('FRAME_LOW_QUALITY');
      if (comparisonCandidate) uncertainties.push('COMPARISON_CONTEXT_UNVERIFIED');
      frames.push({ timeSeconds: index / 2, text: ocr.text, confidence: ocr.confidence,
        comparisonCandidate, contrast: pixel?.contrast ?? null, sharpness: pixel?.sharpness ?? null });
    }
  } finally { if (worker) await worker.terminate(); }
  let transcript, audioStatus = 'UNAVAILABLE';
  if (python && path.isAbsolute(python) && probe.streams.some(stream => stream.codec_type === 'audio')) {
    try {
      const audio = path.join(directory, 'audio.wav');
      await run(ffmpeg, ['-nostdin', '-y', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', input,
        '-vn', '-ac', '1', '-ar', '16000', '-acodec', 'pcm_s16le', audio]);
      const result = JSON.parse((await run(python, [path.join(root, 'scripts/compliance-audio-observations.py'), audio], 60_000)).stdout);
      if (result.status === 'OBSERVED' && typeof result.transcript === 'string' && result.transcript.length <= 4000) {
        transcript = result.transcript; audioStatus = 'OBSERVED';
      }
    } catch { /* ASR failure cannot certify silence or the intended script. */ }
  }
  uncertainties.push(audioStatus === 'OBSERVED' ? 'ASR_UNVERIFIED' : 'AUDIO_UNVERIFIED');
  process.stdout.write(JSON.stringify({ schemaVersion: 1, assetHash: sha(bytes), durationSeconds,
    coverageComplete: false, evidenceVerified: false, frames, transcript, audioStatus,
    uncertainties: [...new Set(uncertainties)] }));
}
main().catch(() => { process.stderr.write('LOCAL_MEDIA_INSPECTION_FAILED'); process.exitCode = 1; });
