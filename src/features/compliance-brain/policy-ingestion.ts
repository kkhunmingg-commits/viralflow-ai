import {createHash} from "node:crypto";
import type {PolicyCandidate,PolicyRegistry,PolicySource} from "./policy-registry";

/** This is an article-text hash, not a hash of the publisher's raw HTML bytes. */
export function normalizePolicyText(text:string):string {
  return text.replace(/^\uFEFF/,"").normalize("NFC").replace(/\r\n?/g,"\n")
    .split("\n").map(line=>line.replace(/[\t \u00a0]+/g," ").trim()).join("\n")
    .replace(/\n{3,}/g,"\n\n").trim();
}
export const policySourceHash=(text:string)=>createHash("sha256").update(normalizePolicyText(text),"utf8").digest("hex");

/** Narrow official Thailand Shop source allowlist; no redirects or arbitrary fetch URLs. */
export function isOfficialPolicyUrl(input:string):boolean {
  try{
    const url=new URL(input);
    return url.protocol==="https:"&&url.hostname==="seller-th.tiktok.com"&&!url.username&&!url.password&&(!url.port||url.port==="443")
      &&url.pathname==="/university/essay"&&/^\d+$/.test(url.searchParams.get("knowledge_id")??"");
  }catch{return false}
}
export interface PolicySourceSnapshot {source:PolicySource;text:string}
export function createPolicySourceSnapshot(metadata:Omit<PolicySource,"sourceHash"|"hashBasis">,articleText:string):PolicySourceSnapshot {
  if(!isOfficialPolicyUrl(metadata.url))throw new Error("POLICY_SOURCE_URL_NOT_OFFICIAL");
  const text=normalizePolicyText(articleText);
  if(text.length<20||Buffer.byteLength(text,"utf8")>512000)throw new Error("POLICY_SOURCE_TEXT_INVALID");
  return{source:{...metadata,sourceHash:policySourceHash(text),hashBasis:"NORMALIZED_TEXT_V1"},text};
}
export interface PolicyTextDiff {changed:boolean;previousHash:string|null;sourceHash:string;added:string[];removed:string[]}
export function diffPolicySource(previousText:string|null,nextText:string):PolicyTextDiff {
  const next=normalizePolicyText(nextText),previous=previousText===null?null:normalizePolicyText(previousText);
  const before=new Set(previous?.split("\n").filter(Boolean)??[]),after=new Set(next.split("\n").filter(Boolean));
  return{changed:previous===null||previous!==next,previousHash:previous===null?null:policySourceHash(previous),sourceHash:policySourceHash(next),
    added:[...after].filter(line=>!before.has(line)),removed:[...before].filter(line=>!after.has(line))};
}

export interface OfficialPolicyIngestionOptions {
  /** Extraction must return article text, without page navigation or instructions from the page. */
  extractArticleText:(html:string)=>string|Promise<string>;
  fetcher?:typeof fetch;timeoutMs?:number;maxBytes?:number;previousText?:string|null;
}
/** Fetching creates only DISCOVERED candidates. Parsing, review, signing and activation are separate. */
export async function ingestOfficialPolicySource(registry:Pick<PolicyRegistry,"discover">,
  metadata:Omit<PolicySource,"sourceHash"|"hashBasis">,options:OfficialPolicyIngestionOptions):Promise<{candidate:PolicyCandidate;diff:PolicyTextDiff}> {
  if(!isOfficialPolicyUrl(metadata.url))throw new Error("POLICY_SOURCE_URL_NOT_OFFICIAL");
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),options.timeoutMs??10000);
  try{
    const response=await(options.fetcher??fetch)(metadata.url,{method:"GET",redirect:"error",signal:controller.signal,headers:{accept:"text/html,text/plain"}});
    if(!response.ok)throw new Error(`POLICY_SOURCE_FETCH_FAILED:${response.status}`);
    if(response.url&&(!isOfficialPolicyUrl(response.url)||new URL(response.url).href!==new URL(metadata.url).href))throw new Error("POLICY_SOURCE_REDIRECT_DENIED");
    if(!/^(text\/html|text\/plain)\b/i.test(response.headers.get("content-type")??""))throw new Error("POLICY_SOURCE_CONTENT_TYPE_INVALID");
    const maxBytes=Math.min(options.maxBytes??512000,512000),length=Number(response.headers.get("content-length"));
    if(Number.isFinite(length)&&length>maxBytes)throw new Error("POLICY_SOURCE_TOO_LARGE");
    if(!response.body)throw new Error("POLICY_SOURCE_EMPTY");
    const reader=response.body.getReader(),chunks:Uint8Array[]= [];let bytes=0;
    try{
      while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>maxBytes)throw new Error("POLICY_SOURCE_TOO_LARGE");chunks.push(chunk.value)}
    }finally{await reader.cancel().catch(()=>undefined)}
    const article=await options.extractArticleText(Buffer.concat(chunks).toString("utf8")),snapshot=createPolicySourceSnapshot(metadata,article);
    const diff=diffPolicySource(options.previousText??null,snapshot.text);
    return{candidate:await registry.discover(snapshot.source,snapshot.text,diff.previousHash),diff};
  }finally{clearTimeout(timeout)}
}
