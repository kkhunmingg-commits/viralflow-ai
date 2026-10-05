import {createHash} from "node:crypto";
import {open,readFile,rename,unlink,type FileHandle} from "node:fs/promises";
import {join} from "node:path";
import type {BenchmarkCandidate,BenchmarkFixture,BenchmarkSample} from "./types";

interface Journal {version:1;samples:BenchmarkSample[];fingerprints:Record<string,string>}
/** Only a recorded provider bill can lower the reserve for a paid attempt. */
export const benchmarkLiability=(sample:BenchmarkSample)=>sample.costBasis==="PROVIDER_RECORDED"&&sample.recordedCostUsd!=null
  ?sample.recordedCostUsd:Math.max(sample.actualCostUsd??0,sample.generationCount>0?sample.expectedCostUsd:0);
/** One output directory is one durable spend ledger; a crashed lock requires reconciliation, never another submit. */
export class BenchmarkJournal {
  private state:Journal;
  private constructor(private directory:string,private lock:FileHandle,state:Journal){this.state=state}
  static async acquire(directory:string,prior:BenchmarkSample[]=[]){
    const lock=await open(join(directory,"benchmark.lock"),"wx");
    try{
      let state:Journal={version:1,samples:prior,fingerprints:{}};
      try{state=JSON.parse(await readFile(join(directory,"benchmark-journal.json"),"utf8")) as Journal}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error}
      if(state.version!==1||!Array.isArray(state.samples)||!state.fingerprints)throw new Error("Invalid benchmark journal");
      if(state.samples.some(row=>["ATTEMPT_RESERVED","SUBMITTED","UNKNOWN"].includes(row.submissionState??"")))throw new Error("Prior paid attempt requires provider reconciliation; paid resume blocked");
      const rows=new Map(state.samples.map(row=>[row.id,row]));
      for(const row of prior)if(!rows.has(row.id))rows.set(row.id,row);
      state.samples=[...rows.values()];
      if(state.samples.some(row=>["ATTEMPT_RESERVED","SUBMITTED","UNKNOWN"].includes(row.submissionState??"")))throw new Error("Prior paid attempt requires provider reconciliation; paid resume blocked");
      if(state.samples.some(row=>!Number.isFinite(row.expectedCostUsd)||row.expectedCostUsd<0||!Number.isInteger(row.generationCount)||row.generationCount<0||row.actualCostUsd!==null&&(!Number.isFinite(row.actualCostUsd)||row.actualCostUsd<0)||row.recordedCostUsd!=null&&(!Number.isFinite(row.recordedCostUsd)||row.recordedCostUsd<0)))throw new Error("Invalid benchmark liability; refusing paid execution");
      return new BenchmarkJournal(directory,lock,state);
    }catch(error){await lock.close();await unlink(join(directory,"benchmark.lock"));throw error}
  }
  get samples(){return this.state.samples}
  async checkInput(id:string,candidate:BenchmarkCandidate,fixture:BenchmarkFixture,repeat:number){
    const hash=createHash("sha256").update(await readFile(fixture.imagePath)).update(JSON.stringify({prompt:fixture.prompt,endpoint:candidate.apiModel,resolution:candidate.resolution,cost:candidate.expectedCostUsd,repeat})).digest("hex");
    if(this.state.fingerprints[id]&&this.state.fingerprints[id]!==hash)throw new Error("Benchmark input changed; refusing a second paid attempt");
    this.state.fingerprints[id]=hash;
  }
  async save(sample:BenchmarkSample){
    const rows=new Map(this.state.samples.map(row=>[row.id,row]));rows.set(sample.id,structuredClone(sample));this.state.samples=[...rows.values()];
    const path=join(this.directory,"benchmark-journal.json"),temporary=`${path}.tmp`,file=await open(temporary,"w");
    try{await file.writeFile(JSON.stringify(this.state,null,2));await file.sync()}finally{await file.close()}
    await rename(temporary,path);
  }
  async close(){await this.lock.close();await unlink(join(this.directory,"benchmark.lock"))}
}
