import {spawn} from "node:child_process";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {describe,expect,it,vi} from "vitest";
import ffmpeg from "ffmpeg-static";
vi.mock("server-only",()=>({}));
import {analyzeVideo,critiqueVideo,dHash,hashStatistics,type VideoSignals} from "./creative-critic";
import {composeStoryboard} from "./storyboard-composer";
import {directAd,type DirectorInput} from "../creative/ad-director";
import {buildStoryboard} from "../creative/storyboard";

const run=(args:string[])=>new Promise<void>((ok,fail)=>{const child=spawn(ffmpeg!,["-nostdin","-hide_banner","-loglevel","error","-y",...args],{windowsHide:true});const err:Buffer[]=[];
  child.stderr.on("data",d=>err.push(Buffer.from(d)));child.on("error",fail);child.on("close",code=>code===0?ok():fail(new Error(Buffer.concat(err).toString())))});
// Signals shaped like the rejected Flow clip: valid H.264/AAC 720p 8 s, but one near-static shot and a silent track.
const staticClip:VideoSignals={duration:8,width:720,height:1280,fps:24,videoCodec:"h264",audioCodec:"aac",sizeBytes:2_800_000,loudnessLufs:-63.4,truePeakDb:-50,maxVolumeDb:-48,
  blackSeconds:0,frozenSeconds:0,decodeErrors:0,sceneCuts:[],frameHashes:Array(32).fill("0f0f0f0f0f0f0f0f"),sampleInterval:.25,distinctLooks:1,longestStaticSeconds:8,meanAdjacentDistance:0,visualChanges:0};

describe("video critic",()=>{
  it("hashes frames and measures static runs",()=>{
    const flat=new Uint8Array(72).fill(9),ramp=Uint8Array.from({length:72},(_,i)=>255-(i%9)*20);
    expect(dHash(flat)).toBe("0000000000000000");expect(dHash(ramp)).toBe("ffffffffffffffff");
    expect(hashStatistics(["0000000000000000","0000000000000000","ffffffffffffffff"],.5)).toMatchObject({distinctLooks:2,longestStaticSeconds:1});
  });
  it("does not let a valid file pass as a good advert, and never asks for regeneration",()=>{
    const verdict=critiqueVideo(staticClip,{storyboard:null,productPixels:"AI_RECONSTRUCTED",cost:{flowCredits:10,thb:null,note:"observed"}});
    expect(verdict.technical.checks.find(c=>c.key==="codec")!.status).toBe("PASS");
    expect(verdict.technical.status).toBe("TECHNICAL_FAIL");
    expect(verdict.creative.status).toBe("CREATIVE_FAIL");
    expect(verdict.creative.checks.filter(c=>c.status==="FAIL").map(c=>c.key)).toEqual(expect.arrayContaining(["hook","storyStructure","noPadding","audioPresence","noDeception"]));
    expect(verdict.decision).toBe("REVISE_STORYBOARD_OR_EDIT");expect(verdict.nextAction).toContain("ห้าม Generate ใหม่อัตโนมัติ");
    expect(verdict.failureRecord).toMatchObject({rejected:true,cost:{flowCredits:10}});
    expect(verdict.semantic.status).toBe("UNKNOWN");
  });
  it("treats an approved-style continuous take as review-ready, not as a failed edit",()=>{
    // Signals measured on the owner's approved reference: one take, no cuts, natural motion, audible track.
    const early=["0000000000000000","0000000000000003","0000000000000003","0000000000000003","0000000000000003","000000000000003f","00000000000001ff","0000000000000fff","0000000000000fff"];
    const take:VideoSignals={...staticClip,frameHashes:[...early,...Array(23).fill("0000000000000fff")],loudnessLufs:-15.1,truePeakDb:-2,maxVolumeDb:-2,distinctLooks:2,longestStaticSeconds:4.25,meanAdjacentDistance:2.71,visualChanges:1};
    const verdict=critiqueVideo(take,{production:"FLOW_NATIVE_TAKE",productPixels:"AI_RENDERED_FROM_REFERENCE",aigcDisclosed:true,styleTags:["HANDS_IN_STYLED_SET"]});
    expect(verdict.technical.status).toBe("TECHNICAL_PASS");
    expect(verdict.creative.status).toBe("CREATIVE_REVIEW");
    expect(verdict.decision).toBe("READY_FOR_OWNER_REVIEW");
    expect(verdict.visual.checks.find(c=>c.key==="productAccuracy")!.status).toBe("UNKNOWN");
    // The rejected Casio take is still rejected under the same rules: silent and a rejected look.
    const casio=critiqueVideo(staticClip,{production:"FLOW_NATIVE_TAKE",productPixels:"AI_RENDERED_FROM_REFERENCE",styleTags:["STATIC_MACRO_PUSH_IN","SILENT_TRACK"]});
    expect(casio.creative.status).toBe("CREATIVE_FAIL");
    // A take that sits still for its first two seconds has no hook, even when it is otherwise fine.
    expect(critiqueVideo({...take,frameHashes:Array(32).fill("0000000000000fff")},{production:"FLOW_NATIVE_TAKE",productPixels:"AI_RENDERED_FROM_REFERENCE",aigcDisclosed:true}).creative.checks.find(c=>c.key==="earlyAction")!.status).toBe("FAIL");expect(casio.decision).toBe("REVISE_STORYBOARD_OR_EDIT");
  });
  it("renders a storyboard into a multi-shot edit and rejects its pasted-card look by owner taste (synthetic fixture, local only)",async()=>{
    const dir=await mkdtemp(join(tmpdir(),"storyboard-test-"));
    try{
      const photo=join(dir,"product.png");
      // A synthetic product shot (shapes on white) stands in for a cleared photograph.
      await run(["-f","lavfi","-i","color=c=white:size=900x900,drawbox=x=250:y=200:w=400:h=500:color=0x1E3A5F:t=fill,drawbox=x=320:y=300:w=260:h=180:color=0xC8E6C9:t=fill","-frames:v","1",photo]);
      const input:DirectorInput={product:{id:"p",title:"Fixture Watch",categoryKey:"watch"},facts:[{id:"f1",text:"น้ำหนัก 21 กรัม"},{id:"f2",text:"นาฬิกาดิจิทัล"}],
        assets:[{id:"img",kind:"REAL_IMAGE",rightsCleared:true,credit:"Synthetic fixture"}],account:{id:"a",mode:"GROWTH",affiliateEligible:false}};
      const plan=await directAd(input),board=buildStoryboard(plan.concepts.find(c=>c.format==="PRODUCT_DETAIL")!,input);
      const out=join(dir,"ad.mp4"),composed=await composeStoryboard({board,assets:{img:photo},credit:"Synthetic fixture",workDir:join(dir,"work"),outputPath:out});
      expect(composed).toMatchObject({width:1080,height:1920,hasAudio:true,audio:"LOCAL_SYNTH_MUSIC"});
      expect(composed.durationSeconds).toBeCloseTo(8,1);expect(Math.abs(composed.loudnessLufs!+14)).toBeLessThanOrEqual(2);
      expect(composed.textEvents.some(e=>e.kind==="CTA")).toBe(true);
      expect(composed.styleTags).toContain("PASTED_PHOTO_CARD");
      const verdict=critiqueVideo(await analyzeVideo(out),{storyboard:board,productPixels:"REAL_ASSET_COMPOSITE",textEvents:composed.textEvents,styleTags:composed.styleTags});
      expect(verdict.technical.status).toBe("TECHNICAL_PASS");
      expect(verdict.signals.distinctLooks).toBeGreaterThanOrEqual(3);
      // Mechanically sound, but the owner rejected this look, so it goes back to the director.
      expect(verdict.creative.checks.filter(c=>c.status==="FAIL").map(c=>c.key)).toEqual(["ownerTaste"]);
      expect(verdict.decision).toBe("REVISE_STORYBOARD_OR_EDIT");
    }finally{await rm(dir,{recursive:true,force:true})}
  },300000);
});
