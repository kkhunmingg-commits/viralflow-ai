import "server-only";
import {availableParallelism,cpus,freemem,totalmem} from "node:os";
import {adaptiveConcurrency} from "./adaptive";
let previous:{total:number;idle:number}|null=null;
/** Local CPU/RAM measurements affect work admission, never account registration. */
export function resourceAdmission(queueDepth:number,providerSlots:number|null,measuredJobBytes:number|null=null){
  const times=cpus().reduce((sum,cpu)=>({total:sum.total+Object.values(cpu.times).reduce((n,t)=>n+t,0),idle:sum.idle+cpu.times.idle}),{total:0,idle:0});
  const delta=previous?times.total-previous.total:0,cpuBusy=previous&&delta>0?Math.min(1,Math.max(0,1-(times.idle-previous.idle)/delta)):null;previous=times;
  const snapshot={cpuUnits:availableParallelism(),cpuBusy,freeBytes:Math.min(freemem(),process.availableMemory()),totalBytes:Math.min(totalmem(),process.constrainedMemory()||totalmem()),rssBytes:process.memoryUsage().rss,measuredJobBytes,providerSlots,queueDepth};
  return{snapshot,concurrency:adaptiveConcurrency(snapshot)};
}
