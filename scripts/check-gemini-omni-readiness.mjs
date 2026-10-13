// Read-only check. No generation, credential output, browser access, billing changes or file writes.
import {existsSync} from 'node:fs';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
let key=process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY||process.env.GOOGLE_GENAI_API_KEY;
let modelAvailable=null,httpStatus=null;
try{
  if(key){
    const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-omni-1.1-flash',{
      method:'GET',headers:{'x-goog-api-key':key},redirect:'error',signal:AbortSignal.timeout(15_000)});
    httpStatus=response.status;
    if(response.ok){const body=await response.json();modelAvailable=body.name==='models/gemini-omni-1.1-flash';}
    else await response.body?.cancel();
  }
  console.log(JSON.stringify({keyConfigured:Boolean(key),modelAvailable,httpStatus,billing:'UNKNOWN_REQUIRES_AI_STUDIO_PROJECT_CHECK',
    paidGenerationCalls:0,apiExecutionEnabled:process.env.GEMINI_OMNI_API_ENABLED==='true'}));
}catch{console.log(JSON.stringify({keyConfigured:Boolean(key),modelAvailable:null,billing:'UNKNOWN',readOnlyCheck:'UNAVAILABLE',paidGenerationCalls:0}));}
finally{key=undefined;delete process.env.GEMINI_API_KEY;delete process.env.GOOGLE_API_KEY;delete process.env.GOOGLE_GENAI_API_KEY;}
