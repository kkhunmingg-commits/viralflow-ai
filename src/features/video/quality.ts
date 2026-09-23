import {VIDEO_DURATION_SECONDS,VIDEO_HEIGHT,VIDEO_QUALITY_VERSION,VIDEO_WIDTH,type VideoQualityEvaluator,type VideoQualityInput,type VideoQualityResult} from "./types";

const timingOk=(input:VideoQualityInput)=>input.scenes.length>=3&&input.scenes[0]?.start===0&&input.scenes.at(-1)?.end===8&&input.scenes.every((s,i)=>s.end>s.start&&(i===0||input.scenes[i-1]?.end===s.start));
export class DeterministicVideoQualityEvaluator implements VideoQualityEvaluator {
  evaluate(input:VideoQualityInput):VideoQualityResult {
    const visual=input.visualVerification;
    const actualFrames=visual?.evidence.length===3&&visual.evidence.every(frame=>/^[a-f0-9]{64}$/.test(frame.sha256));
    const visualPass=Boolean(actualFrames&&visual?.status==="PASS");
    const format=input.sizeBytes>0&&input.videoCodec==="h264";
    const duration=Math.abs(input.duration-VIDEO_DURATION_SECONDS)<=.08;
    const aspect=Math.abs(input.width/input.height-9/16)<.01;
    const resolution=input.width>=Math.min(540,VIDEO_WIDTH)&&input.height>=Math.min(960,VIDEO_HEIGHT);
    const overlay=input.overlay.length===0||input.overlay.every(t=>t.start>=0&&t.end<=8&&t.end>t.start&&t.text.trim().length>0);
    const timing=timingOk(input);
    const audio=input.hasAudio&&input.audioCodec==="aac";
    const visibleText=visualPass&&visual?.checks.visibleText==="PASS";
    const checks={format,duration,aspect,resolution,
      productVisibility:visualPass&&visual?.productVisible===true&&visual.checks.shape==="PASS"&&visual.checks.colors==="PASS"&&visual.checks.packaging==="PASS"&&visual.checks.details==="PASS"&&visual.checks.deformation==="PASS",
      overlayReadability:overlay&&visibleText,safeTextPlacement:visibleText,
      sceneContinuity:timing&&visualPass&&visual?.checks.commercialSafety==="PASS",
      audioPresence:audio,nonEmptyFrames:input.sizeBytes>10_000&&Boolean(actualFrames),assetsValid:!input.malformedAssets,
      ctaVisibility:visualPass&&visual?.ctaVisible===true,creativeTiming:timing,riskAccepted:input.inheritedRisk==="SAFE"};
    const weights={format:10,duration:10,aspect:8,resolution:7,productVisibility:10,overlayReadability:7,safeTextPlacement:5,sceneContinuity:8,audioPresence:5,nonEmptyFrames:7,assetsValid:5,ctaVisibility:5,creativeTiming:5,riskAccepted:8};
    const score=Math.min(100,Object.entries(weights).reduce((sum,[key,value])=>sum+(checks[key as keyof typeof checks]?value:0),0));
    const critical=format&&duration&&aspect&&timing&&!input.malformedAssets&&input.inheritedRisk==="SAFE"&&visualPass&&checks.productVisibility&&checks.ctaVisibility&&visibleText&&visual?.checks.commercialSafety==="PASS";
    const status=input.inheritedRisk==="REJECT"||!format||input.malformedAssets||visual?.status==="FAIL"?"REJECT":critical&&score>=85?"PASS":"RETRY";
    return {score,status,explanation:{version:VIDEO_QUALITY_VERSION,...checks,
      visualVerificationStatus:visual?.status??"REVIEW",visualVerificationReason:visual?.reason??"VISION_PROVIDER_UNAVAILABLE",
      visualVerificationProvider:visual?.provider??"unavailable",visualVerificationModel:visual?.model??"none",
      visualChecks:visual?.checks??null,visualReasons:visual?.reasons??["VISION_PROVIDER_UNAVAILABLE"],
      visualFrameEvidence:visual?.evidence??[]}};
  }
}
