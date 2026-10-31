import {spawnSync} from "node:child_process";
import {mkdir,mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe,expect,it} from "vitest";
import {ffmpegBinary} from "./ffmpeg-binary";
import {buildGraphicStoryboard,graphicStorySeconds,renderGraphicStoryMaster} from "./graphic-story";
import {readabilityCheck} from "./local-composer";
import {LocalCommandThaiVoice} from "./thai-voice";

const copy={seed:"project-1",hook:"รู้ไหม เรื่องนี้มีเหตุผล",script:"รู้ไหม เรื่องนี้มีเหตุผล วางของใช้บ่อยไว้ใกล้มือ ติดตามไว้",cta:"ติดตามไว้"};
const frame=(file:string,at:number)=>{const r=spawnSync(ffmpegBinary()!,["-hide_banner","-loglevel","error","-ss",String(at),"-i",file,"-frames:v","1","-vf","crop=1080:600:0:660,format=gray","-f","rawvideo","-"]);
  if(r.status!==0)throw new Error(String(r.stderr));return r.stdout};
const brightShare=(pixels:Buffer)=>{let n=0;for(const p of pixels)if(p>200)n++;return n/pixels.length};

describe("original graphic story",()=>{
  it("gives a three-point list the 10-second cut and every other format 8 seconds",()=>{
    expect(graphicStorySeconds({format:"LIST",basis:"t",beats:[]})).toBe(10);
    expect(graphicStorySeconds({format:"QUIZ_REVEAL",basis:"t",beats:[]})).toBe(8);
  });
  it("splits hook, one point and call to action into readable cards with a seeded palette",()=>{
    const board=buildGraphicStoryboard(copy);
    expect(board.cards.map(c=>c.headline)).toEqual(["รู้ไหม เรื่องนี้มีเหตุผล","วางของใช้บ่อยไว้ใกล้มือ","ติดตามไว้"]);
    expect(buildGraphicStoryboard(copy)).toEqual(board);
    expect(board.cards.every(c=>c.palette.every(v=>/^0x[0-9A-F]{6}$/.test(v)))).toBe(true);
  });
  it("refuses copy that cannot be read in time instead of shrinking it",()=>{
    expect(()=>buildGraphicStoryboard({...copy,script:`${copy.hook} ${"ข้อความยาวเกินจะอ่านทัน".repeat(3)} ${copy.cta}`})).toThrow("GRAPHIC_CARD_TOO_LONG");
    expect(()=>buildGraphicStoryboard({...copy,script:`${copy.hook} ${copy.cta}`})).toThrow("GRAPHIC_STORY_COPY_MISSING");
  });
  it("judges caption-only readability on coverage, hold time and reading speed",()=>{
    expect(readabilityCheck([{text:"สั้น",start:0,end:2.5},{text:"อ่านทัน",start:2.7,end:5.2},{text:"ติดตาม",start:5.4,end:7.9}],8).passed).toBe(true);
    expect(readabilityCheck([{text:"สั้น",start:0,end:1}],8).passed).toBe(false);
    expect(readabilityCheck([{text:"ข้อความยาวมากเกินกว่าจะอ่านทันในเวลาสั้น",start:0,end:8}],8).passed).toBe(true);
    expect(readabilityCheck([{text:"ข้อความยาวมากเกินกว่าจะอ่านทันในเวลาสั้น",start:0,end:2},{text:"ก",start:2,end:8}],8).passed).toBe(false);
  });
  it("renders a caption-only cut that passes QC only because the cards are readable",async()=>{
    const dir=await mkdtemp(join(tmpdir(),"viralflow-graphic-"));
    try{
      const result=await renderGraphicStoryMaster({storyboard:buildGraphicStoryboard(copy),script:copy.script,tts:null,workDir:dir,outputPath:join(dir,"out.mp4")});
      expect(result.narration).toMatchObject({kind:"CAPTION_ONLY"});
      expect(result.media).toMatchObject({width:1080,height:1920,videoCodec:"h264",audioCodec:"aac"});
      expect(result.media.duration).toBeCloseTo(8,1);
      expect(result.checks.find(c=>c.name==="READABILITY")?.passed).toBe(true);
      expect(result.checks.find(c=>c.name==="VOICE")?.passed).toBe(true);
      expect(result.passed).toBe(true);
      // White card text must actually be drawn in the middle of each card.
      for(const at of [1.3,4,6.6])expect(brightShare(frame(join(dir,"out.mp4"),at))).toBeGreaterThan(.004);
    }finally{await rm(dir,{recursive:true,force:true})}
  },120_000);
  it("uses licensed local Thai TTS when configured and records its provenance",async()=>{
    const dir=await mkdtemp(join(tmpdir(),"viralflow-graphic-tts-"));
    try{
      const fake=join(dir,"fake-tts.mjs");
      await writeFile(fake,`import {spawnSync} from "node:child_process";let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
        const r=spawnSync(${JSON.stringify(ffmpegBinary())},["-loglevel","error","-y","-f","lavfi","-i","sine=frequency=220:duration=6","-af","volume=0.1",j.output]);process.exit(r.status??1)});`);
      const work=join(dir,"work");await mkdir(work);
      const result=await renderGraphicStoryMaster({storyboard:buildGraphicStoryboard(copy),script:copy.script,tts:new LocalCommandThaiVoice([process.execPath,fake]),workDir:work,outputPath:join(dir,"out.mp4")});
      expect(result.narration).toMatchObject({kind:"SYSTEM_TTS",provider:"voxcpm2-local",license:{modelLicense:"Apache-2.0",aiGenerated:true}});
      expect(result.media.hasAudio).toBe(true);
      expect(result.passed).toBe(true);
    }finally{await rm(dir,{recursive:true,force:true})}
  },120_000);
});
