import test from "node:test";
import assert from "node:assert/strict";
import { validateJob, inspectMp4, assertContained, safeJobFilename, shouldGenerate, newResultId, isFlowLocation } from "./core.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const valid = { jobId: id, prompt: "Eight second portrait product atmosphere", portalUrl: "https://viralflow.example" };

test('recognizes the current official Flow domain and legacy entry without accepting lookalikes', () => {
  for (const url of ['https://flow.google.com/?pli=1', `https://flow.google.com/project/${id}`, 'https://labs.google/fx/tools/flow', 'https://labs.google/fx/tools/flow/project/1']) {
    assert.equal(isFlowLocation(url), true, url);
  }
  for (const url of ['https://flow.google.com.evil.example/', 'https://flow.google.com@evil.example/', 'https://user@flow.google.com/', 'http://flow.google.com/', 'https://flow.google.com:444/', 'https://accounts.google.com/', 'https://labs.google/fx/tools/flow-lookalike', 'invalid']) {
    assert.equal(isFlowLocation(url), false, url);
  }
});

test("parses valid Flow handoff without credentials", () => {
  const job = validateJob(valid);
  assert.equal(job.jobId, id);
  assert.equal(job.portalUrl, "https://viralflow.example");
  assert.equal(job.imageUrl, null);
});
test("rejects unsafe jobs and non-HTTPS portals", () => {
  assert.throws(() => validateJob({ ...valid, jobId: "../../etc/passwd" }), /INVALID_JOB_ID/);
  assert.throws(() => validateJob({ ...valid, prompt: "" }), /INVALID_PROMPT/);
  assert.throws(() => validateJob({ ...valid, portalUrl: "http://attacker.example" }), /INVALID_PORTAL_URL/);
  assert.throws(() => validateJob({ ...valid, imageUrl: "file:///etc/passwd" }), /INVALID_IMAGE_URL/);
});
test("checks MP4 signature and max size before importing", () => {
  const video = Buffer.alloc(100);
  video.write("ftyp", 4, "ascii");
  assert.equal(inspectMp4(video).size, 100);
  assert.match(inspectMp4(video).sha256, /^[0-9a-f]{64}$/);
  assert.throws(() => inspectMp4(Buffer.from("not a video")), /INVALID_MP4_OR_SIZE/);
});
test("rejects traversal and ambiguous retry after submission", () => {
  assert.equal(safeJobFilename(id), id + ".mp4");
  assert.throws(() => assertContained("/tmp/flow", "/tmp/outside/file"), /UNSAFE_FILE_PATH/);
  assert.equal(shouldGenerate({ state: "GENERATING" }), false);
  assert.equal(shouldGenerate({ state: "DOWNLOADED" }), false);
  assert.equal(shouldGenerate({ state: "IMPORTED" }), false);
  assert.equal(shouldGenerate({ state: "NEEDS_REVIEW" }), false);
  assert.equal(shouldGenerate({ state: "UNKNOWN" }), false);
  assert.equal(shouldGenerate(null), true);
});

test('selects a new result when Flow prepends it or changes result order', () => {
  assert.equal(newResultId(['old'], ['new', 'old']), 'new');
  assert.equal(newResultId(['a', 'b'], ['b', 'a']), null);
  assert.equal(newResultId(['a', 'b'], ['new', 'b']), 'new');
});
test('stops on ambiguous or uncalibrated result identity', () => {
  assert.throws(() => newResultId(['old'], ['new-1', 'old', 'new-2']), /AMBIGUOUS_NEW_RESULTS/);
  assert.throws(() => newResultId([], [null]), /CALIBRATE_UNIQUE_RESULT_IDS/);
  assert.throws(() => newResultId(['same', 'same'], ['same']), /CALIBRATE_UNIQUE_RESULT_IDS/);
});
