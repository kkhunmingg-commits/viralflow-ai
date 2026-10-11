// Read-only provider metadata; the selected key exists only in this process.
import { readFile } from 'node:fs/promises';
let source = await readFile('.env.local','utf8');
let key = source.match(/^FAL_KEY\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g,''); source = null;
if (!key) throw new Error('Server key missing');
try {
  const ids=['openrouter/router','fal-ai/flux/schnell','fal-ai/minimax/speech-02-hd','fal-ai/ltxv-13b-098-distilled/image-to-video'];
  const url=new URL('https://api.fal.ai/v1/models/pricing'); url.searchParams.set('endpoint_id',ids.join(','));
  const response=await fetch(url,{headers:{Authorization:`Key ${key}`},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok) console.log(JSON.stringify({pricingStatus:response.status}));
  else { const body=await response.json(); console.log(JSON.stringify({prices:body.prices?.map(row=>({endpoint:row.endpoint_id,unit:row.unit,price:row.unit_price,currency:row.currency})),hasMore:body.has_more})); }
} finally { key=null; }
