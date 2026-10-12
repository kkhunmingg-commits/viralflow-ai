import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {it,expect,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import ffmpeg from "ffmpeg-static";
vi.mock("server-only",()=>({}));
import {finalizeProviderMaster,type ProviderCreativeSource} from "./finalize";
import {renderRoutedVariation} from "./variations";
import {FFmpegVideoRenderer} from "@/features/video/renderer";
const owner=randomUUID(),product=randomUUID(),project=randomUUID(),script=randomUUID(),job=randomUUID();
const source:ProviderCreativeSource={project:{id:project},product:{id:product,title:"Local test fixture"},script:{id:script,cta_text:"ดูรายละเอียด"},angle:{policy_status:"SAFE"},input:{productTitle:"Local fixture",hook:"Fixture",cta:"Fixture",overlay:[],template:"PRODUCT_REVEAL",scenes:[{start:0,end:2,visual:"fixture",motion:"static"},{start:2,end:5,visual:"fixture",motion:"static"},{start:5,end:8,visual:"fixture",motion:"static"}]} as unknown as ProviderCreativeSource["input"]};
function fixtureDatabase(reference:Uint8Array){
  const objects=new Map<string,Blob>([[`owner/${owner}/products/photo.jpg`,new Blob([new Uint8Array(reference)])]]);
  const rows:Record<string,Record<string,unknown>[]>={media_assets:[{owner_id:owner,product_id:product,asset_type:"PRODUCT_IMAGE",source_type:"UPLOAD",storage_path:`owner/${owner}/products/photo.jpg`}],master_videos:[],generation_jobs:[{id:job,owner_id:owner}],video_variations:[]};
  function from(table:string){let operation="read",values:Record<string,unknown>={};const filters:Array<(r:Record<string,unknown>)=>boolean>=[];
    const q={select:()=>q,eq:(key:string,value:unknown)=>{filters.push(row=>row[key]===value);return q;},in:(key:string,values:unknown[])=>{filters.push(row=>values.includes(row[key]));return q;},order:()=>q,limit:()=>q,upsert:(row:Record<string,unknown>)=>{operation="upsert";values=row;return q;},update:(row:Record<string,unknown>)=>{operation="update";values=row;return q;},single:async()=>execute(true),maybeSingle:async()=>execute(true),then:(resolve:(r:unknown)=>void)=>Promise.resolve(execute(false)).then(resolve)};
    function execute(single:boolean){let found=rows[table].filter(row=>filters.every(f=>f(row)));if(operation==="upsert"){const prior=rows[table].find(row=>table==="master_videos"?row.owner_id===values.owner_id&&row.creative_project_id===values.creative_project_id:row.storage_path===values.storage_path);if(prior){Object.assign(prior,values);found=[prior];}else{const row={id:randomUUID(),...values};rows[table].push(row);found=[row];}}if(operation==="update")found.forEach(row=>Object.assign(row,values));return{data:single?found[0]??null:found,error:null};}return q;
  }
  return{rows,objects,client:{from,storage:{from:()=>({download:async(path:string)=>({data:objects.get(path),error:null}),upload:async(path:string,bytes:Uint8Array)=>{objects.set(path,new Blob([new Uint8Array(bytes)]));return{error:null};}})}} as unknown as SupabaseClient};
}
it("validates real MP4/audio/frames, imports master, renders real crop and keeps visual review closed",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"provider-media-test-"));
  const run=(args:string[])=>new Promise<void>((resolve,reject)=>{const child=spawn(ffmpeg!,["-nostdin","-hide_banner","-loglevel","error","-y",...args],{windowsHide:true,stdio:"ignore"});child.on("error",reject);child.on("close",code=>code===0?resolve():reject(new Error("local fixture failed")));});
  try{
    const videoPath=join(dir,"fixture.mp4"),imagePath=join(dir,"photo.png");
    // Clearly synthetic LOCAL test fixture proves media processing only, not actual Google/fal quality.
    await run(["-f","lavfi","-i","testsrc2=size=360x640:rate=24:duration=8.1","-f","lavfi","-i","sine=frequency=440:sample_rate=32000:duration=8.1","-c:v","libx264","-preset","ultrafast","-pix_fmt","yuv420p","-c:a","aac",videoPath]);
    await run(["-i",videoPath,"-frames:v","1",imagePath]);
    const db=fixtureDatabase(new Uint8Array(await readFile(imagePath))),bytes=new Uint8Array(await readFile(videoPath));
    const input={id:job,generation_job_id:job,tiktok_account_id:randomUUID(),creative_project_id:project,provider:"google_vids_omni" as const,estimated_cost_usd:0};
    await expect(finalizeProviderMaster(db.client,owner,input,source,new Uint8Array([1,2,3]),null)).rejects.toThrow();
    const master=await finalizeProviderMaster(db.client,owner,input,source,bytes,null);
    expect(master.quality_status).toBe("RETRY");const row=db.rows.master_videos[0];
    expect(row.status).toBe("READY");expect(row.provider).toBe("google_vids_omni");
    expect((row.quality_explanation_json as {visualFrameEvidence:unknown[]}).visualFrameEvidence).toHaveLength(3);
    const variation={id:randomUUID(),owner_id:owner,variation_index:1,product_id:product,creative_project_id:project};db.rows.video_variations.push(variation);
    const result=await renderRoutedVariation(db.client,owner,row,variation,{id:job});expect(result.quality_status).toBe("RETRY");
    const file=db.objects.get(String(result.storage_path))!;const finalPath=join(dir,"variation.mp4");await writeFile(finalPath,new Uint8Array(await file.arrayBuffer()));
    const actual=await new FFmpegVideoRenderer().probe(finalPath);expect(actual).toMatchObject({width:1080,height:1920,hasAudio:true,videoCodec:"h264",audioCodec:"aac"});expect(actual.duration).toBeCloseTo(8,1);
    expect(db.rows.media_assets.some(row=>row.source_type==="MOCK")).toBe(false);
    await expect(finalizeProviderMaster(db.client,owner,{...input,generation_job_id:randomUUID()},source,bytes,null)).rejects.toThrow("EXISTING_MASTER_REQUIRES_REVIEW");
  }finally{await rm(dir,{recursive:true,force:true});}
},180_000);
