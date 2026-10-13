// Local-only metadata inventory. Never reads secret contents or uploads artifacts.
import {opendir,stat,mkdir,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join,relative,extname} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(process.argv[2]??'.'),output=resolve(process.argv[3]??'.handoff-backup/inventory.json');
const cacheNames=new Set(['.git','node_modules','.next','.venv','.venv-dev','__pycache__','.build','.handoff-backup']);
const secretName=name=>/^\.env(?:\.|$)/i.test(name)&&name!=='.env.example'||/^(?:cookies?|session|credentials?|secrets?|private[-_]key|auth[-_]state)(?:[._-]|$)/i.test(name);
const sourceExtensions=new Set(['.py','.ts','.tsx','.mjs','.mts','.cjs','.ps1','.sh','.md','.sql','.toml','.yml','.yaml']);
const trackedResult=spawnSync('git',['-C',root,'ls-files','-z'],{encoding:'utf8',windowsHide:true});
if(trackedResult.status!==0)throw new Error('INVENTORY_GIT_UNAVAILABLE');
const tracked=new Set(trackedResult.stdout.split('\0').filter(Boolean));
const rows=[],omitted=[];
async function hash(path){const sha=createHash('sha256');for await(const bytes of createReadStream(path))sha.update(bytes);return sha.digest('hex');}
async function walk(dir){
  for await(const entry of await opendir(dir)){
    const path=join(dir,entry.name),name=relative(root,path).replaceAll('\\','/');
    if(entry.isSymbolicLink()){omitted.push({path:name,reason:'SYMLINK_NOT_FOLLOWED'});continue;}
    if(entry.isDirectory()){
      if(cacheNames.has(entry.name)){omitted.push({path:name,reason:'REBUILDABLE_DEPENDENCY_OR_CACHE'});continue;}
      await walk(path);continue;
    }
    if(!entry.isFile())continue;
    if(secretName(entry.name)){omitted.push({path:name,reason:'SECRET_OR_SESSION_FILE_EXCLUDED'});continue;}
    const s=await stat(path);
    if(extname(path)==='.pyc'||path.endsWith('.tsbuildinfo')){omitted.push({path:name,reason:'REBUILDABLE_CACHE'});continue;}
    rows.push({path:name,absolutePath:path,bytes:s.size,sha256:await hash(path),tracked:tracked.has(name),
      sourceCandidate:!tracked.has(name)&&sourceExtensions.has(extname(path)),modifiedAt:s.mtime.toISOString(),
      backupStatus:tracked.has(name)?'GIT_REFERENCE_REQUIRES_REMOTE_VERIFICATION':'LOCAL_ONLY_PENDING_REVIEW',
      provenance:'UNVERIFIED_UNLESS_DOCUMENTED_IN_PROJECT_MANIFEST',license:'UNVERIFIED_DO_NOT_REDISTRIBUTE'});
  }
}
await walk(root);
await mkdir(resolve(output,'..'),{recursive:true});
await writeFile(output,JSON.stringify({createdAt:new Date().toISOString(),workspace:root,scope:'Project files excluding dependency/build caches and secret files; metadata only, not a file backup',rows,omitted},null,2));
console.log(JSON.stringify({workspace:root,manifest:output,files:rows.length,localOnly:rows.filter(r=>!r.tracked).length,
  localBytes:rows.filter(r=>!r.tracked).reduce((sum,r)=>sum+r.bytes,0),omitted:omitted.length}));
