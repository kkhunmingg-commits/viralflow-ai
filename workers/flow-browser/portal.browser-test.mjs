import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { importTarget } from './portal.mjs';
import { assertContained } from './core.mjs';
import { createServer } from 'node:http';

const testRoot = resolve(fileURLToPath(new URL('../../.runtime/tmp/', import.meta.url)));
if (process.platform === 'win32' && !/^D:\\/i.test(testRoot)) throw new Error('TEST_WORKSPACE_MUST_BE_ON_D');
const job = { jobId: '11111111-1111-4111-8111-111111111111', portalUrl: '' };
let context, server, dir, html = '', login = false;
before(async () => {
  await mkdir(testRoot, { recursive: true });
  dir = await mkdtemp(join(testRoot, 'flow-portal-test-'));
  server = createServer((request, response) => {
    if (login && request.url !== '/login') { response.writeHead(302, { location: '/login' }); response.end(); return; }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  job.portalUrl = 'http://127.0.0.1:' + server.address().port;
  context = await chromium.launchPersistentContext(join(dir, 'profile'), {
    headless: true, downloadsPath: join(dir, 'downloads')
  });
  // Only local fixture HTML: no requests to Google, ViralFlow or a real account.
});
after(async () => {
  if (context) await context.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (dir) await rm(assertContained(testRoot, dir), { recursive: true, force: true });
});

test('blocks generation readiness when the portal redirects to login', async () => {
  login = true; html = '<h1>Login</h1>';
  const page = await context.newPage();
  try { await assert.rejects(importTarget(page, job, 500), /VIRALFLOW_LOGIN_REQUIRED/); }
  finally { await page.close(); login = false; }
});
test('blocks an older deployed portal without the exported original job', async () => {
  html = '<h1>Older Video Factory</h1>';
  const page = await context.newPage();
  try { await assert.rejects(importTarget(page, job, 500), /WORKER_UI_UNAVAILABLE_NO_GENERATION/); }
  finally { await page.close(); }
});
test('accepts only the matching job with the complete existing import form', async () => {
  html = `<article data-flow-job-id="${job.jobId}"><input name="video" type="file"><input name="attested" type="checkbox"><button>นำคลิปเข้างานเดิมและตรวจ</button></article>`;
  const page = await context.newPage();
  try { assert.equal((await importTarget(page, job, 500)).masterUrl, null); }
  finally { await page.close(); }
});
test('recognizes an already imported master without another Generate', async () => {
  html = `<article data-flow-job-id="${job.jobId}"><a href="/video-factory/master">เปิดวิดีโอเพื่อตรวจ</a></article>`;
  const page = await context.newPage();
  try { assert.equal((await importTarget(page, job, 500)).masterUrl, job.portalUrl + '/video-factory/master'); }
  finally { await page.close(); }
});
