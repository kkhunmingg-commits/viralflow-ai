import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {it,expect,vi} from "vitest";
import ffmpeg from "ffmpeg-static";
vi.mock("server-only",()=>({}));
import {composeFlowPhoto} from "./flow-photo-composer";
import {flowBackgroundPrompt} from "./flow-background-prompt";
const run=(args:string[])=>new Promise<Buffer>((ok,fail)=>{const child=spawn(ffmpeg!,["-nostdin","-hide_banner","-loglevel","error","-y",...args],{windowsHide:true});const out:Buffer[]=[],err:Buffer[]=[];
  child.stdout.on("data",d=>out.push(Buffer.from(d)));child.stderr.on("data",d=>err.push(Buffer.from(d)));child.on("error",fail);child.on("close",code=>code===0?ok(Buffer.concat(out)):fail(new Error(Buffer.concat(err).toString())));});
it("keeps original photo pixels over a separate background, preserves audio, and refuses a changed reference",async()=>{
  // Synthetic local fixtures: this is compositor proof, not a real Google generation.
  const dir=await mkdtemp(join(tmpdir(),"flow-photo-test-"));
  try{
    const backgroundPath=join(dir,"background.mp4"),photoPath=join(dir,"photo.jpg"),outputPath=join(dir,"edited.mp4");
    await run(["-f","lavfi","-i","color=c=navy:size=360x640:rate=30:duration=8","-f","lavfi","-i","sine=frequency=440:duration=8","-c:v","libx264","-preset","ultrafast","-c:a","aac","-shortest",backgroundPath]);
    await run(["-f","lavfi","-i","color=c=red:size=960x960","-frames:v","1",photoPath]);
    const expectedPhotoSha256=createHash("sha256").update(await readFile(photoPath)).digest("hex"),input={backgroundPath,photoPath,expectedPhotoSha256,title:"Fixture",captions:[{start:0,end:8,text:"ภาพทดสอบ"}],credit:"Synthetic fixture only",workDir:join(dir,"edit"),outputPath};
    await expect(composeFlowPhoto({...input,expectedPhotoSha256:"0".repeat(64)})).rejects.toThrow("FLOW_PHOTO_CHECKSUM_MISMATCH");
    const media=await composeFlowPhoto(input);expect(media).toMatchObject({width:1080,height:1920,hasAudio:true,videoCodec:"h264"});expect(media.duration).toBeCloseTo(8,1);
    const pixel=await run(["-ss","1","-i",outputPath,"-frames:v","1","-vf","crop=20:20:500:500,scale=1:1","-f","rawvideo","-pix_fmt","rgb24","-"]);
    expect(pixel[0]).toBeGreaterThan(180);expect(pixel[1]).toBeLessThan(30);expect(pixel[2]).toBeLessThan(30);
    expect(createHash("sha256").update(await readFile(photoPath)).digest("hex")).toBe(expectedPhotoSha256);
  }finally{await rm(dir,{recursive:true,force:true})}
},180000);
it("requests only a background and exactly the selected narration",()=>{
  const voice="นาฬิกาดิจิทัล น้ำหนัก 21 กรัม",prompt=flowBackgroundPrompt(voice);
  expect(prompt).toContain(JSON.stringify(voice));expect(prompt).toContain("no watch, product");expect(prompt).toContain("original product photograph");
  expect(()=>flowBackgroundPrompt("")).toThrow("FLOW_NARRATION_INVALID");
});
