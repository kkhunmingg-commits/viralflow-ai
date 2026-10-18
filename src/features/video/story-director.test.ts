import {mkdtemp,rm} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe,expect,it} from "vitest";
import {ffmpegBinary} from "./ffmpeg-binary";
import {editQc} from "./local-composer";
import {beatCaptions,beatTimeline,directGraphicStory,directRealMedia,subjectBox,type StoryBeat} from "./story-director";

const beats:StoryBeat[]=[{role:"HOOK",text:"ก่อนซื้อ ดูตรงนี้"},{role:"POINT",text:"ความจุ 500 มิลลิลิตร ฝาสีดำมีห่วงหิ้ว พกง่าย"},{role:"CTA",text:"ดูรายละเอียดสินค้าก่อนตัดสินใจ"}];

describe("story director",()=>{
  it("paces beats to the narration and holds the last beat to the end",()=>{
    const w=beatTimeline(beats,6.5,8);
    expect(w[0].start).toBe(0);expect(w.at(-1)!.end).toBe(8);
    w.slice(1).forEach((x,i)=>expect(x.start).toBeCloseTo(w[i].end,3));
    expect(w.every(x=>x.end-x.start>=1.7-1e-6)).toBe(true);
    // The longer point gets more time than the short hook.
    expect(w[1].end-w[1].start).toBeGreaterThan(w[0].end-w[0].start);
    // Caption-only plans spread over the whole clip.
    expect(beatTimeline(beats,null,8)[1].end).toBeGreaterThan(w[1].end);
  });
  it("captions every beat with no gaps, splitting long beats into readable chunks",()=>{
    const w=beatTimeline(beats,6.5,8),cues=beatCaptions(beats,w);
    expect(cues[0].start).toBe(0);expect(cues.at(-1)!.end).toBe(8);
    cues.slice(1).forEach((c,i)=>expect(c.start).toBeCloseTo(cues[i].end,2));
    expect(cues.length).toBeGreaterThan(beats.length);
  });
  it("cuts a single still into several framings and never holds one shot past the limit",()=>{
    const w=beatTimeline(beats,7.4,8),shots=directRealMedia(beats,w,[{assetId:"a",path:"a.png",kind:"IMAGE"}]);
    expect(shots.length).toBeGreaterThanOrEqual(3);
    expect(new Set(shots.map(s=>s.motion)).size).toBeGreaterThanOrEqual(2);
    expect(Math.max(...shots.map(s=>s.seconds!))).toBeLessThanOrEqual(3.2);
    expect(shots.reduce((a,s)=>a+s.seconds!,0)).toBeCloseTo(8,3);
    const qc=editQc(shots,shots.map(s=>s.seconds!),beatCaptions(beats,w),8);
    expect(qc.every(c=>c.passed)).toBe(true);
  });
  it("prefers real footage for points and keeps footage motion untouched",()=>{
    const w=beatTimeline(beats,6.5,8),shots=directRealMedia(beats,w,[{assetId:"img",path:"a.png",kind:"IMAGE"},{assetId:"vid",path:"b.mp4",kind:"VIDEO"}]);
    const point=shots.find((_,i)=>i===1)!;
    expect(point.kind).toBe("VIDEO");expect(point.motion).toBeUndefined();
  });
  it("fails editing QC for a late hook, a text gap or one long static shot",()=>{
    const one=[{assetId:"a",path:"a.png",kind:"IMAGE" as const,seconds:8,motion:"PUSH_IN" as const}];
    const qc=editQc(one,[8],[{text:"x",start:1,end:2},{text:"y",start:5,end:8}],8);
    expect(qc.find(c=>c.name==="HOOK")?.passed).toBe(false);
    expect(qc.find(c=>c.name==="TEXT_COVERAGE")?.passed).toBe(false);
    expect(qc.find(c=>c.name==="PACING")?.passed).toBe(false);
  });
  it("draws graphic formats with their kicker and badge on every card",()=>{
    const story={format:"LIST" as const,basis:"t",beats:[{role:"HOOK" as const,text:"3 เรื่อง",badge:"3"},{role:"POINT" as const,text:"ข้อแรก",kicker:"ข้อ 1"},{role:"CTA" as const,text:"ติดตาม"}]};
    const clips=directGraphicStory(story,beatTimeline(story.beats,null,8));
    expect(clips.map(c=>[c.kind,c.badge,c.kicker])).toEqual([["GRAPHIC","3",undefined],["GRAPHIC",undefined,"ข้อ 1"],["GRAPHIC",undefined,undefined]]);
  });
  it("finds the product in a still against a gradient, ignoring the background",async()=>{
    const dir=await mkdtemp(join(tmpdir(),"viralflow-subject-"));
    try{
      const file=join(dir,"p.png");
      const r=spawnSync(ffmpegBinary()!,["-loglevel","error","-y","-f","lavfi","-i","gradients=s=540x960:c0=0xDDEEFF:c1=0xAABBCC:x0=0:y0=0:x1=0:y1=960:n=2","-vf","drawbox=x=200:y=300:w=140:h=400:color=0x1155AA:t=fill","-frames:v","1",file]);
      expect(r.status).toBe(0);
      const box=await subjectBox(file);
      expect(box.x).toBeGreaterThan(.3);expect(box.x+box.w).toBeLessThan(.7);
      expect(box.y).toBeGreaterThan(.25);expect(box.y+box.h).toBeLessThan(.8);
    }finally{await rm(dir,{recursive:true,force:true})}
  },30_000);
});
