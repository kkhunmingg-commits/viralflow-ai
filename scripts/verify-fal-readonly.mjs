import {readFile,mkdir,writeFile} from 'node:fs/promises';
// Approved read-only verification. Secrets stay in memory and are never included in result/error payloads.
let key=process.env.FAL_KEY;
if(!key){const local=await readFile('.env.local','utf8').catch(()=> '');const match=local.match(/^\s*FAL_KEY\s*=\s*(.+)\s*$/m);key=match?.[1]?.trim().replace(/^['"]|['"]$/g,'');}
const models=['fal-ai/ltxv-13b-098-distilled/image-to-video','fal-ai/ltx-2.3/image-to-video/fast','wan/v2.6/image-to-video/flash'];
const result={at:new Date().toISOString(),configured:Boolean(key),pricing:[],billing:null,paidCalls:0,postingCalls:0};
try {
 if(key){
  for(const model of models){
   const url=new URL('https://api.fal.ai/v1/models/pricing');url.searchParams.set('endpoint_id',model);
   const response=await fetch(url,{method:'GET',headers:{Authorization:`Key ${key}`},redirect:'error',signal:AbortSignal.timeout(15000)});
   let price=null;if(response.ok){const body=await response.json();const p=body.prices?.find(item=>item.endpoint_id===model);if(p)price={unit:p.unit,unitPrice:p.unit_price,currency:p.currency};}
   result.pricing.push({model,http:response.status,price});
  }
  const url=new URL('https://api.fal.ai/v1/models/billing-events');url.searchParams.set('limit','1');
  const response=await fetch(url,{method:'GET',headers:{Authorization:`Key ${key}`},redirect:'error',signal:AbortSignal.timeout(15000)});
  result.billing={http:response.status,readable:response.ok};
  if(response.ok){const body=await response.json();result.billing.hasRecords=Boolean(body.billing_events?.length);}
 }
}catch{result.network='Read-only verification unavailable';}finally{key=undefined;delete process.env.FAL_KEY;}
await mkdir('test-results/multi-account',{recursive:true});await writeFile('test-results/multi-account/fal-readonly.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
