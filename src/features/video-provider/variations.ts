import "server-only";
import {randomUUID,createHash} from "node:crypto";
import {mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import type {SupabaseClient} from "@supabase/supabase-js";
import {composeGeneratedVideo} from "@/features/video/media-composition";
import {ownsVideoStoragePath,videoStoragePath} from "@/features/video/storage";
type Row=Record<string,unknown>;
const check=(error:unknown)=>{if(error)throw new Error("REAL_VARIATION_STORAGE_FAILED");};
export const isRoutedMaster=(provider:unknown)=>provider==="google_vids_omni"||provider==="fal_ai";
/** Crops real master footage and preserves its actual audio; never substitutes mock assets. */
export async function renderRoutedVariation(client:SupabaseClient,owner:string,master:Row,variation:Row,job:Row){
  const path=String(master.storage_path??"");if(!ownsVideoStoragePath(owner,path))throw new Error("REAL_MASTER_REQUIRED");
  const file=await client.storage.from("video-assets").download(path);check(file.error);
  if(!file.data||file.data.size>50_000_000)throw new Error("REAL_MASTER_REQUIRED");
  const dir=join(tmpdir(),"viralflow-real-variation",randomUUID());await mkdir(dir,{recursive:true});
  try{
    const source=join(dir,"source.mp4"),output=join(dir,"variation.mp4");await writeFile(source,new Uint8Array(await file.data.arrayBuffer()));
    const cropInset=Math.min(3,Math.max(1,Number(variation.variation_index)))*.02;
    const {media}=await composeGeneratedVideo(source,output,{durationSeconds:8,resolution:"1080p",overlay:[],preserveAudio:true,cropInset});
    const bytes=new Uint8Array(await readFile(output)),storagePath=videoStoragePath(owner,"variations",String(variation.id),"video.mp4");
    check((await client.storage.from("video-assets").upload(storagePath,bytes,{contentType:"video/mp4",upsert:true})).error);
    const explanation={source:"REAL_MASTER",cropInset,verifiedVisual:false,reason:"การครอปอาจตัดสินค้า/ข้อความ ต้องตรวจภาพและความซ้ำก่อนอนุมัติ",thaiNarrationVerified:false};
    check((await client.from("media_assets").upsert({owner_id:owner,product_id:variation.product_id,creative_project_id:variation.creative_project_id,
      asset_type:"VIDEO",source_type:"RENDERED",storage_path:storagePath,mime_type:"video/mp4",width:media.width,height:media.height,
      duration_seconds:media.duration,provider:"local-ffmpeg",model:"real-master-crop",checksum:createHash("sha256").update(bytes).digest("hex")},{onConflict:"owner_id,storage_path"})).error);
    const values={generation_job_id:job.id,storage_path:storagePath,status:"READY",quality_status:"RETRY",quality_score:0,quality_explanation_json:explanation};
    check((await client.from("video_variations").update(values).eq("owner_id",owner).eq("id",variation.id)).error);
    check((await client.from("generation_jobs").update({status:"COMPLETED",output_json:{variationId:variation.id,quality:explanation},completed_at:new Date().toISOString()}).eq("owner_id",owner).eq("id",job.id)).error);
    return{...variation,...values};
  }finally{await rm(dir,{recursive:true,force:true});}
}
