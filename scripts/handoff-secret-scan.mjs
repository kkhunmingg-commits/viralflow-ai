// Reports locations/counts only. Secret values are read into memory, never printed or saved.
import {existsSync,readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]??'.'),secrets=[];
for(const name of ['.env','.env.local','.env.production','.env.production.local']){
  const file=resolve(root,name);if(!existsSync(file))continue;
  for(const line of readFileSync(file,'utf8').split(/\r?\n/)){
    const match=line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(!match)continue;
    const [,key,raw]=match,value=raw.replace(/^(['"])(.*)\1$/,'$2');
    if(!key.startsWith('NEXT_PUBLIC_')&&/KEY|TOKEN|SECRET|PASSWORD|COOKIE/.test(key)&&value.length>=16&&!/placeholder|example|synthetic|fixture|test[-_]|mock[-_]/i.test(value))secrets.push({name:key,bytes:Buffer.from(value)});
  }
}
function inspect(bytes){const text=bytes.toString('utf8'),kinds=[];
  for(const secret of secrets)if(bytes.includes(secret.bytes))kinds.push(`EXACT_CONFIGURED_${secret.name}`);
  if(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[A-Za-z0-9_-]{16,}/i.test(text))kinds.push('FAL_CREDENTIAL_PATTERN');
  if(/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}/.test(text))kinds.push('OPENAI_CREDENTIAL_PATTERN');
  if(/\bsb_secret_[A-Za-z0-9_-]{30,}/.test(text))kinds.push('SUPABASE_SECRET_PATTERN');
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{40,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))kinds.push('PRIVATE_KEY_MATERIAL');
  for(const jwt of text.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+/g)){
    try{if(JSON.parse(Buffer.from(jwt[0].split('.')[1],'base64url').toString()).role==='service_role')kinds.push('SERVICE_ROLE_JWT');}catch{}
  }
  return [...new Set(kinds)];
}
const list=spawnSync('git',['-C',root,'diff','--cached','--name-only','--diff-filter=ACMR','-z'],{encoding:'utf8',windowsHide:true});
if(list.status!==0)throw new Error('SCAN_INDEX_UNAVAILABLE');
const staged=[];
for(const path of list.stdout.split('\0').filter(Boolean)){
  const blob=spawnSync('git',['-C',root,'show',`:${path}`],{windowsHide:true,maxBuffer:32*1024*1024});
  if(blob.status!==0)throw new Error('SCAN_STAGED_BLOB_UNAVAILABLE');
  const findings=inspect(blob.stdout);if(findings.length)staged.push({path,findings});
  if(/^\.env(?:\.|$)/.test(path)&&path!=='.env.example')staged.push({path,findings:['ENV_FILE_FORBIDDEN']});
}
const history=[];let blobs=0;
await new Promise((resolveScan,reject)=>{
  const child=spawn('git',['-C',root,'cat-file','--batch-all-objects','--batch'],{windowsHide:true,stdio:['ignore','pipe','ignore']});
  let buffer=Buffer.alloc(0),header=null;
  child.stdout.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);
    for(;;){if(!header){const end=buffer.indexOf(10);if(end<0)break;const [oid,kind,size]=buffer.subarray(0,end).toString('ascii').split(' ');header={oid,kind,size:Number(size)};buffer=buffer.subarray(end+1);}
      if(!Number.isSafeInteger(header.size)||header.size<0){child.kill();reject(new Error('SCAN_OBJECT_INVALID'));return;}
      if(buffer.length<header.size+1)break;
      if(header.kind==='blob'){blobs++;const findings=inspect(buffer.subarray(0,header.size));if(findings.length)history.push({object:header.oid,findings});}
      buffer=buffer.subarray(header.size+1);header=null;
    }
  });
  child.on('error',()=>reject(new Error('SCAN_GIT_UNAVAILABLE')));
  child.on('close',code=>code===0&&!header&&!buffer.length?resolveScan():reject(new Error('SCAN_INCOMPLETE')));
});
secrets.forEach(item=>item.bytes.fill(0));secrets.length=0;
console.log(JSON.stringify({stagedFiles:list.stdout.split('\0').filter(Boolean).length,stagedFindings:staged,
  allLocalGitBlobsScanned:blobs,historyFindings:history,scope:'Exact configured secret matches + limited recognizable patterns; not an exhaustive privacy/license certification'}));
if(staged.length)process.exitCode=1;
