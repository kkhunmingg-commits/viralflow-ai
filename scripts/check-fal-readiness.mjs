// Read-only credential/metadata/history checks. Never generates, writes secrets or prints provider errors.
import {existsSync,readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
let key=process.env.FAL_KEY;
const credentialPattern=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[A-Za-z0-9_-]{16,}/i;
function scan(bytes){return{currentKey:key?bytes.includes(Buffer.from(key)):false,credentialPattern:credentialPattern.test(bytes.toString('utf8'))};}
const result={checkedAt:new Date().toISOString(),configured:Boolean(key),metadata:[],billing:null,history:null,paidGenerationCalls:0,tiktokCalls:0,
  execution:{routerEnabled:process.env.VIDEO_PROVIDER_ROUTER_ENABLED==='true',autoApproval:process.env.FAL_WAN_PROVIDER_STATE==='PRODUCTION_APPROVED'},
  isolatedSupabaseConfigured:(()=>{try{return['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL??'').hostname);}catch{return false;}})()};
try{
  const tracked=spawnSync('git',['ls-files','-z'],{encoding:'utf8',windowsHide:true});
  if(tracked.status!==0)throw new Error('git scan unavailable');
  const paths=tracked.stdout.split('\0').filter(Boolean);let trackedHits=0;
  for(const path of paths){if(!existsSync(path))continue;const hit=scan(readFileSync(path));if(hit.currentKey||hit.credentialPattern)trackedHits++;}
  const envTracked=paths.includes('.env.local');
  // Includes all local Git objects, even unreachable objects; never prints matched content.
  const history=await new Promise((resolve,reject)=>{
    const child=spawn('git',['cat-file','--batch-all-objects','--batch'],{windowsHide:true,stdio:['ignore','pipe','ignore']});
    let buffer=Buffer.alloc(0),remaining=null,kind=null,blobs=0,currentHits=0,patternHits=0;
    const timer=setTimeout(()=>{child.kill();reject(new Error('scan timeout'));},60_000);
    child.stdout.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      while(true){
        if(remaining===null){const end=buffer.indexOf(10);if(end<0)break;const header=buffer.subarray(0,end).toString('ascii').split(' ');kind=header[1];remaining=Number(header[2]);buffer=buffer.subarray(end+1);if(!Number.isSafeInteger(remaining)||remaining<0){child.kill();reject(new Error('invalid object'));return;}}
        if(buffer.length<remaining+1)break;
        if(kind==='blob'){const hit=scan(buffer.subarray(0,remaining));blobs++;if(hit.currentKey)currentHits++;if(hit.credentialPattern)patternHits++;}
        buffer=buffer.subarray(remaining+1);remaining=null;
      }
    });
    child.on('error',()=>{clearTimeout(timer);reject(new Error('scan unavailable'));});
    child.on('close',code=>{clearTimeout(timer);if(code===0&&remaining===null&&buffer.length===0)resolve({blobsScanned:blobs,currentKeyBlobMatches:currentHits,falCredentialPatternBlobMatches:patternHits,trackedFileMatches:trackedHits,envLocalTracked:envTracked});else reject(new Error('scan incomplete'));});
  });
  result.history=history;
  if(key){
    for(const model of ['fal-ai/wan/v2.2-a14b/image-to-video/turbo','wan/v2.6/image-to-video/flash']){
      const url=new URL('https://api.fal.ai/v1/models/pricing');url.searchParams.set('endpoint_id',model);
      const response=await fetch(url,{method:'GET',headers:{Authorization:`Key ${key}`},redirect:'error',signal:AbortSignal.timeout(15_000)});
      const item={model,http:response.status,price:null};
      if(response.ok){const body=await response.json();const p=body.prices?.find(p=>p.endpoint_id===model);if(p)item.price={unit:p.unit,unitPrice:p.unit_price,currency:p.currency,complete:body.has_more!==true};}
      else await response.body?.cancel();
      result.metadata.push(item);
    }
    const response=await fetch('https://api.fal.ai/v1/models/billing-events?limit=1',{method:'GET',headers:{Authorization:`Key ${key}`},redirect:'error',signal:AbortSignal.timeout(15_000)});
    result.billing={http:response.status,readable:response.ok,balance:'UNKNOWN'};await response.body?.cancel();
  }
  console.log(JSON.stringify(result));
}catch{console.log(JSON.stringify({...result,checkError:'READ_ONLY_CHECK_INCOMPLETE'}));process.exitCode=1;}
finally{key=undefined;delete process.env.FAL_KEY;}
