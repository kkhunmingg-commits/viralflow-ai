import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe,expect,it} from "vitest";
import {ffmpegBinary} from "./ffmpeg-binary";
import {configuredThaiVoice,LocalCommandThaiVoice,VOXCPM2_LICENSE} from "./thai-voice";

const fakeTts=async(dir:string,seconds:number)=>{const file=join(dir,`tts-${seconds}.mjs`);
  await writeFile(file,`import {spawnSync} from "node:child_process";import {writeFileSync} from "node:fs";let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
    writeFileSync(j.output+".json",JSON.stringify(j));const r=spawnSync(${JSON.stringify(ffmpegBinary())},["-loglevel","error","-y","-f","lavfi","-i","sine=duration=${seconds}",j.output]);process.exit(r.status??1)});`);
  return file};

describe("local Thai TTS provider",()=>{
  it("sends normalised text and a designed voice, then checks the output length",async()=>{
    const dir=await mkdtemp(join(tmpdir(),"viralflow-tts-"));
    try{
      const voice=new LocalCommandThaiVoice([process.execPath,await fakeTts(dir,3)],"calm narrator");
      const out=await voice.synthesize({text:"  สวัสดี\n ครับ ",outputPath:join(dir,"a.wav"),maxSeconds:7.8});
      expect(out.durationSeconds).toBeCloseTo(3,0);
      const {readFile}=await import("node:fs/promises");
      expect(JSON.parse(await readFile(join(dir,"a.wav.json"),"utf8"))).toMatchObject({text:"สวัสดี ครับ",voice:"calm narrator"});
      const long=new LocalCommandThaiVoice([process.execPath,await fakeTts(dir,9)]);
      await expect(long.synthesize({text:"ยาว",outputPath:join(dir,"b.wav"),maxSeconds:7.8})).rejects.toThrow("thai_tts_too_long");
      await expect(voice.synthesize({text:" ",outputPath:join(dir,"c.wav"),maxSeconds:7.8})).rejects.toThrow("thai_tts_text_invalid");
      await expect(new LocalCommandThaiVoice([process.execPath,"-e","process.exit(3)"]).synthesize({text:"ก",outputPath:join(dir,"d.wav"),maxSeconds:7.8})).rejects.toThrow("thai_tts_failed");
    }finally{await rm(dir,{recursive:true,force:true})}
  },60_000);
  it("is off unless explicitly configured with a local interpreter",()=>{
    expect(configuredThaiVoice({})).toBeNull();
    expect(configuredThaiVoice({THAI_TTS_PROVIDER:"voxcpm2"})).toBeNull();
    expect(configuredThaiVoice({THAI_TTS_PROVIDER:"voxcpm2",THAI_TTS_PYTHON:"python3",THAI_TTS_SCRIPT:"/missing.py"})).toBeNull();
    expect(configuredThaiVoice({THAI_TTS_PROVIDER:"voxcpm2",THAI_TTS_PYTHON:"python3"})?.license).toEqual(VOXCPM2_LICENSE);
  });
});
