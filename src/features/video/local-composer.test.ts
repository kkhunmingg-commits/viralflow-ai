import {spawnSync} from "node:child_process";
import {mkdir,mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe,expect,it} from "vitest";
import {ffmpegBinary} from "./ffmpeg-binary";
import {buildAssSubtitles,composeRealMedia,composerArgs,composerQc,segmentDurations,wrapThaiCaption} from "./local-composer";

const ffmpeg=(args:string[])=>{const r=spawnSync(ffmpegBinary()!,["-hide_banner","-loglevel","error","-y",...args]);if(r.status!==0)throw new Error(String(r.stderr));return r.stdout};
const media={path:"x",duration:8,width:1080,height:1920,fps:30,videoCodec:"h264",audioCodec:"aac",hasAudio:true,sizeBytes:1};

describe("local real-media composer",()=>{
  it("wraps Thai at word boundaries counting only base characters",()=>{
    expect(wrapThaiCaption("ไม้ถูพื้นบิดน้ำได้ด้วยถังปั่น ไม่ต้องใช้มือ")).toEqual(["ไม้ถูพื้นบิดน้ำได้ด้วยถังปั่น","ไม่ต้องใช้มือ"]);
    expect(()=>wrapThaiCaption("ข้อความยาวมาก".repeat(10))).toThrow("caption_too_long");
    expect(wrapThaiCaption("ติดตามไว้ ตอนต่อไปมีอีก",13,4)).toEqual(["ติดตามไว้","ตอนต่อไปมีอีก"]);
  });
  it("keeps caption text from injecting ASS overrides and validates timing",()=>{
    const ass=buildAssSubtitles([{text:"ลด{\\an8\\b0}ราคา",start:0,end:3}],8);
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:03.00,Caption,,0,0,0,,ลดan8b0ราคา\n");
    expect(ass).toContain("Style: Caption,Noto Sans Thai,");
    expect(()=>buildAssSubtitles([{text:"x",start:5,end:5}],8)).toThrow("caption_timing_invalid");
  });
  it("splits duration on frame boundaries and limits clip count",()=>{
    expect(segmentDurations(3,8).map(v=>Math.round(v*30))).toEqual([80,80,80]);
    expect(segmentDurations(3,8).reduce((a,b)=>a+b,0)).toBeCloseTo(8,5);
    expect(()=>segmentDurations(0,8)).toThrow();expect(()=>segmentDurations(7,8)).toThrow();
  });
  it("drops source audio and uses silence when there is no narration",()=>{
    const args=composerArgs({clips:[{assetId:"a",path:"clip.mp4",kind:"VIDEO"}],durations:[8],durationSeconds:8,outputPath:"out.mp4"}).join(" ");
    expect(args).toContain("anullsrc");expect(args).not.toContain("[0:a]");expect(args).toContain("ass=subtitles.ass:fontsdir=fonts");
  });
  it("fails QC for silent output and off-target loudness",()=>{
    expect(composerQc(media,null,{durationSeconds:8,hasVoice:false}).find(c=>c.name==="VOICE")?.passed).toBe(false);
    expect(composerQc(media,-23,{durationSeconds:8,hasVoice:true}).find(c=>c.name==="LOUDNESS")?.passed).toBe(false);
    expect(composerQc(media,-14.4,{durationSeconds:8,hasVoice:true}).every(c=>c.passed)).toBe(true);
    expect(composerQc({...media,width:720},-14,{durationSeconds:8,hasVoice:true}).find(c=>c.name==="RESOLUTION")?.passed).toBe(false);
  });
  it("renders footage and a still into an 8-second 1080x1920 clip with visible Thai captions and normalised voice",async()=>{
    const dir=await mkdtemp(join(tmpdir(),"viralflow-composer-"));
    try{
      ffmpeg(["-f","lavfi","-i","color=c=0x336699:size=1280x720:rate=30:duration=3","-c:v","libx264","-pix_fmt","yuv420p",join(dir,"clip.mp4")]);
      ffmpeg(["-f","lavfi","-i","color=c=0x996633:size=800x800","-frames:v","1",join(dir,"still.png")]);
      ffmpeg(["-f","lavfi","-i","sine=frequency=300:duration=7","-af","volume=0.05",join(dir,"voice.wav")]);
      const clips=[{assetId:"a",path:join(dir,"clip.mp4"),kind:"VIDEO" as const},{assetId:"b",path:join(dir,"still.png"),kind:"IMAGE" as const}];
      const compose=async(name:string,captions:Array<{text:string;start:number;end:number}>)=>{const work=join(dir,name);await mkdir(work);
        return composeRealMedia({clips,captions,voicePath:join(dir,"voice.wav"),durationSeconds:8,workDir:work,outputPath:join(dir,`${name}.mp4`)})};
      const result=await compose("captioned",[{text:"ถังปั่นบิดน้ำได้",start:.5,end:7.5}]);await compose("plain",[]);
      expect(result.media).toMatchObject({width:1080,height:1920,videoCodec:"h264",audioCodec:"aac",hasAudio:true});
      expect(result.media.duration).toBeCloseTo(8,1);expect(result.loudnessLufs!).toBeGreaterThan(-16);expect(result.loudnessLufs!).toBeLessThan(-12);
      expect(result.passed).toBe(true);
      // The caption band must differ from the same render without captions.
      const band=(file:string)=>ffmpeg(["-ss","2","-i",join(dir,file),"-frames:v","1","-vf","crop=1080:300:0:1350,format=gray","-f","rawvideo","-"]);
      const a=band("captioned.mp4"),b=band("plain.mp4");let changed=0;for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>40)changed++;
      expect(changed/a.length).toBeGreaterThan(.02);
    }finally{await rm(dir,{recursive:true,force:true})}
  },120_000);
});
