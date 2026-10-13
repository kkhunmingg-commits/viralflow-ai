import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,sep} from 'node:path';
const root=resolve(process.argv[2]??'.');
const rows=JSON.parse((await readFile(resolve(root,'handoff/local-source/INDEX.json'),'utf8')).replace(/^\uFEFF/,''));
const errors=[];
for(const row of rows){
  const file=resolve(root,row.ArchivePath),archiveRoot=resolve(root,'handoff/local-source')+sep;
  if(!file.startsWith(archiveRoot)||!file.endsWith('.source'))throw new Error('ARCHIVE_PATH_INVALID');
  const info=await stat(file),bytes=await readFile(file);
  if(info.size!==row.Bytes||createHash('sha256').update(bytes).digest('hex')!==row.SHA256)errors.push(row.ArchivePath);
}
console.log(JSON.stringify({archivedSources:rows.length,hashMatches:rows.length-errors.length,errors,
  status:errors.length?'FAIL':'PASS',sourceExecutionPerformed:false}));
if(errors.length)process.exitCode=1;
