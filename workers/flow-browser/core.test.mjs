import test from "node:test";
import assert from "node:assert/strict";
import { validateJob, inspectMp4, assertContained, safeJobFilename, shouldGenerate } from "./core.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const valid = { jobId: id, prompt: "Eight second portrait product atmosphere", portalUrl: "https://viralflow.example" };

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
  assert.equal(shouldGenerate(null), true);
});
