/** Real local decoders/OCR/ASR, synthetic fixtures, shared production authority; zero paid calls. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { ComplianceEngine } from "../src/features/compliance-brain/engine";
import { passesCompliance } from "../src/features/compliance-brain/gates";
import { holdoutInput } from "../src/features/compliance-brain/holdout-corpus";
import { appendMediaObservations, localMediaObservationSchema } from "../src/features/compliance-brain/media-observations";
import { validatePolicyPackPayload } from "../src/features/compliance-brain/policy-pack";
import { GroundedSemanticClassifier } from "../src/features/compliance-brain/semantic";

function characterErrorRate(expected:string,actual:string){
  const chars=(text:string)=>[...text.normalize("NFKC").toLowerCase().replace(/\s|[.!?,]/gu,"")];
  const a=chars(expected),b=chars(actual);let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const current=[i];for(let j=1;j<=b.length;j++)current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));previous=current;}
  return a.length?previous[b.length]/a.length:null;
}
async function main(){
  const root=process.cwd(),directory=path.resolve(root,".video-cache/compliance-real-world");
  const data=JSON.parse(await readFile("docs/compliance-brain/real-world-holdout.json","utf8")) as {
    cases:Array<{id:string;text:string;allowed:boolean;video?:boolean;comparison?:boolean}>;
    mediaOnly:Array<{id:string;text:string;speech?:string;comparison?:boolean}>;
  };
  const draft=JSON.parse(await readFile("docs/compliance-brain/tiktok-th-policy-draft-2026-10-09.json","utf8"));
  const payload=validatePolicyPackPayload(draft.payload),classifier=new GroundedSemanticClassifier();
  const engine=new ComplianceEngine({policy:async()=>payload,classifier});
  const textResults=[];
  for(const row of data.cases)for(const channel of ["POST","LIVE"] as const)for(const field of ["script","caption"] as const){
    const input=holdoutInput(row.text,"SKINCARE",channel,row.allowed?row.text:undefined);input.now=new Date().toISOString();
    input.content={[field]:row.text};
    const assessment=await classifier.classify(input),decision=await engine.evaluate(input);
    textResults.push({id:row.id,channel,field,expectedAllow:row.allowed,status:decision.status,allowed:passesCompliance(decision),
      recognizedRisks:assessment.findings.filter(finding=>finding.category!=="UNKNOWN_FACT").map(finding=>finding.category)});
  }
  const records=[];
  const inputs=[...data.cases.filter(row=>row.video),...data.mediaOnly];
  for(const row of inputs){
    const source=path.join(directory,"videos",`${row.id}.mp4`),bytes=await readFile(source);
    const assetHash=createHash("sha256").update(bytes).digest("hex");
    const scratch=path.join(directory,"inspections",row.id);await mkdir(scratch,{recursive:true});
    await writeFile(path.join(scratch,"input.mp4"),bytes);
    const env:NodeJS.ProcessEnv={NODE_ENV:"production",SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:process.env.TEMP,TMP:process.env.TMP,
      HF_HUB_OFFLINE:"1",TRANSFORMERS_OFFLINE:"1",COMPLIANCE_OCR_DATA_PATH:path.join(directory,"ocr-models"),
      COMPLIANCE_FFMPEG_PATH:ffmpeg!,COMPLIANCE_FFPROBE_PATH:ffprobe.path,
      COMPLIANCE_MEDIA_PYTHON:path.join(root,".venv-dev/Scripts/python.exe")};
    const started=Date.now();
    const output=await promisify(execFile)(process.execPath,["--max-old-space-size=384",path.join(root,"scripts/compliance-media-worker.mjs"),path.join(scratch,"input.mp4")],
      {env,timeout:120_000,windowsHide:true,maxBuffer:1_000_000,shell:false});
    const observation=localMediaObservationSchema.parse(JSON.parse(output.stdout));
    const input=holdoutInput("ตรวจสอบข้อมูลสินค้า","SKINCARE","POST");input.now=new Date().toISOString();
    // Only observed pixels/audio reach this media authority; intended fixture copy is not its input.
    input.content=appendMediaObservations({caption:"ตรวจสอบข้อมูลสินค้า"},observation,assetHash);
    input.stage="FINAL_PUBLISH";input.media={assetHash,coverageComplete:false,evidenceRefs:[]};
    const assessment=await classifier.classify(input),decision=await engine.evaluate(input);
    const observedText=[...new Set(observation.frames.map(frame=>frame.text).filter(Boolean))].join("\n");
    const record={id:row.id,sourcePath:source,assetHash,seconds:(Date.now()-started)/1000,observation,
      observedText,ocrCharacterErrorRate:characterErrorRate(row.text,observedText),
      speechCharacterErrorRate:"speech" in row?characterErrorRate(row.speech??"",observation.transcript??""):null,
      status:decision.status,allowed:passesCompliance(decision),
      recognizedRisks:assessment.findings.filter(finding=>finding.category!=="UNKNOWN_FACT").map(finding=>finding.category)};
    records.push(record);await writeFile(path.join(scratch,"observation.json"),JSON.stringify(record,null,2));
    // Retain frames/observation as local proof; delete the redundant input, not the source video.
    await rm(path.join(scratch,"input.mp4"));
    console.log(JSON.stringify({id:row.id,status:decision.status,ocr:observedText,transcript:observation.transcript??null,seconds:record.seconds}));
  }
  const safe=textResults.filter(row=>row.expectedAllow),risk=textResults.filter(row=>!row.expectedAllow);
  const summary={sentences:data.cases.length,evaluations:textResults.length,highRiskAllowed:risk.filter(row=>row.allowed).length,
    highRiskHeld:risk.filter(row=>!row.allowed).length,highRiskSemanticallyRecognized:risk.filter(row=>row.recognizedRisks.length).length,
    benignEvaluations:safe.length,benignHeld:safe.filter(row=>!row.allowed).length,
    fixtureTextFalsePositiveRate:safe.filter(row=>!row.allowed).length/safe.length,
    actualEncodedVideos:records.length,mediaReleasedWithoutVerification:records.filter(row=>row.allowed).length,
    exactOcrVideos:records.filter(row=>row.ocrCharacterErrorRate===0).length,realProducts:0,realProductEvidence:0,
    paidCalls:0,tikTokPostingCalls:0,policyActivated:false};
  await writeFile(path.join(directory,"validation-report.json"),JSON.stringify({evaluatedAt:new Date().toISOString(),summary,
    fixtureOnly:true,productionPolicySignature:null,textResults,records,
    limitations:["No real product/PDP/label evidence supplied by owner; no real product acceptance.",
      "Local sampled OCR/ASR observations do not certify visual meaning, manipulation, authenticity or product identity.",
      "False positive rate measures this frozen synthetic text set only; media reviews are intentional coverage holds.",
      "Thai speech, short-lived overlays and low-quality/rotated text need broader representative validation."]},null,2));
  console.log(JSON.stringify(summary));
  if(summary.highRiskAllowed||summary.benignHeld||summary.mediaReleasedWithoutVerification)process.exitCode=1;
}
main().catch(()=>{console.error("LOCAL_REAL_WORLD_PROOF_FAILED");process.exitCode=1});
