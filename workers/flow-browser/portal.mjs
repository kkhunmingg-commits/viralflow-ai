// Read-only UI readiness check. It never submits a form or creates an external job.
export async function importTarget(page, job, timeout = 15_000) {
  await page.goto(job.portalUrl + '/video-factory/providers', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (new URL(page.url()).origin !== job.portalUrl || new URL(page.url()).pathname === '/login') {
    throw new Error('VIRALFLOW_LOGIN_REQUIRED');
  }
  const card = page.locator('article[data-flow-job-id="' + job.jobId + '"]');
  try { await card.waitFor({ state: 'visible', timeout }); }
  catch { throw new Error('VIRALFLOW_JOB_OR_WORKER_UI_UNAVAILABLE_NO_GENERATION'); }
  const master = card.locator('a[href^="/video-factory/"]');
  if (await master.count()) return { card, masterUrl: new URL(await master.first().getAttribute('href'), job.portalUrl).href };
  if (!(await card.locator('input[name="video"]').count()) || !(await card.locator('input[name="attested"]').count()) ||
      !(await card.getByRole('button', { name: /นำคลิปเข้างานเดิมและตรวจ/ }).count())) {
    throw new Error('VIRALFLOW_IMPORT_FORM_UNAVAILABLE_NO_GENERATION');
  }
  return { card, masterUrl: null };
}
