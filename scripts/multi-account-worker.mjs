// Dedicated host/service entry point. Requires an explicitly configured staging origin and token.
// No secrets are written to disk or included in logs; Ctrl+C aborts pending work safely.
const origin = new URL(process.env.MULTI_ACCOUNT_WORKER_ORIGIN ?? 'http://127.0.0.1:3018');
if ((origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['127.0.0.1','localhost'].includes(origin.hostname))) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Invalid worker origin');
if (!process.env.MULTI_ACCOUNT_WORKER_TOKEN) throw new Error('Worker authorization is not configured');
const controller = new AbortController();
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => controller.abort());
let failures = 0;
while (!controller.signal.aborted) {
  try {
    const response = await fetch(new URL('/api/multi-account/tick', origin), {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.MULTI_ACCOUNT_WORKER_TOKEN}` },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(285000)]), redirect: 'error',
    });
    if ([401,403].includes(response.status)) throw new Error('Authorization rejected; stopping worker');
    if (!response.ok) failures++; else { failures = 0; console.log(JSON.stringify({ at:new Date().toISOString(), tick:'completed' })); }
  } catch (error) {
    if (controller.signal.aborted) break;
    if (error.message?.startsWith('Authorization')) throw error;
    failures++;
  }
  // Bounded backoff; repeated outages stop the process for the host supervisor to inspect.
  if (failures >= 8) throw new Error('Worker unavailable after bounded retries');
  await new Promise(resolve => { const timer=setTimeout(done,Math.min(60000,5000*2**failures));function done(){clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();}controller.signal.addEventListener('abort',done,{once:true}); });
}
delete process.env.MULTI_ACCOUNT_WORKER_TOKEN;
