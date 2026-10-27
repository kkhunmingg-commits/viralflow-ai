import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';

const run = promisify(execFile);
const require = createRequire(import.meta.url);

export async function probeBinary() {
  let binary = process.env.FFPROBE_BINARY;
  if (!binary) {
    try { binary = require('ffprobe-static').path; }
    catch { throw new Error('FFPROBE_REQUIRED_INSTALL_PROJECT_DEPENDENCIES'); }
  }
  try { await access(binary); }
  catch { throw new Error('FFPROBE_BINARY_UNAVAILABLE'); }
  return binary;
}

// Container signatures alone also accept empty/truncated files. Probe actual video streams.
export async function inspectVideo(path) {
  const binary = await probeBinary();
  let data;
  try {
    const result = await run(binary, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path],
      { timeout: 30_000, maxBuffer: 2_000_000, windowsHide: true });
    data = JSON.parse(result.stdout);
  } catch { throw new Error('MP4_PROBE_FAILED'); }
  const video = data.streams?.find(stream => stream.codec_type === 'video');
  const durationSeconds = Number(video?.duration ?? data.format?.duration);
  if (!video || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || !(video.width > 0 && video.height > 0)) {
    throw new Error('MP4_VIDEO_STREAM_REQUIRED');
  }
  const rotation = Number(video.tags?.rotate ?? video.side_data_list?.find(item => item.rotation != null)?.rotation ?? 0);
  const rotated = Math.abs(rotation % 180) === 90;
  const width = rotated ? video.height : video.width, height = rotated ? video.width : video.height;
  if (Math.abs(width / height - 9 / 16) > .02) throw new Error('MP4_PORTRAIT_9_16_REQUIRED');
  return { width, height, durationSeconds, codec: video.codec_name,
    hasAudio: data.streams.some(stream => stream.codec_type === 'audio') };
}
