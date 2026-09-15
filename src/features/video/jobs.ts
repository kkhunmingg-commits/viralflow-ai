import {createHash} from "node:crypto";

export const masterJobKey=(creativeProjectId:string,scriptId:string)=>`master:${creativeProjectId}:${scriptId}`;
export const variationJobKey=(variationId:string,runId:string)=>`variation:${variationId}:${runId}`;
export function variationRunId(masterId:string){
  const bytes=Buffer.from(createHash("sha256").update(`video-variations-v1:${masterId}`).digest().subarray(0,16));
  bytes[6]=(bytes[6]&0x0f)|0x50;
  bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function nextJobAttempt(current:number,max:number){return current>=max?{allowed:false,attempt:current,status:"FAILED" as const}:{allowed:true,attempt:current+1,status:current===0?"PROCESSING" as const:"RETRYING" as const}}
