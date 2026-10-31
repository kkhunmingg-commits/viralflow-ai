import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {analyzeVideo,critiqueVideo,type VideoCritique} from "./creative-critic";
import {VIDEO_BUCKET} from "./types";

/** Owner-triggered creative critique of a stored master. The verdict is saved beside the existing quality
 * record (quality_explanation_json.creativeCritic) and never changes quality_status, approval or publishing. */
export async function critiqueStoredMaster(client:SupabaseClient,owner:string,masterId:string):Promise<VideoCritique>{
  const master=await client.from("master_videos").select("id,storage_path,provider,render_strategy,quality_explanation_json").eq("owner_id",owner).eq("id",masterId).maybeSingle();
  if(master.error||!master.data?.storage_path)throw new Error("VIDEO_FILE_UNAVAILABLE");
  const file=await client.storage.from(VIDEO_BUCKET).download(String(master.data.storage_path));
  if(file.error||!file.data)throw new Error("VIDEO_FILE_UNAVAILABLE");
  const dir=await mkdtemp(join(tmpdir(),"critic-"));
  try{
    const path=join(dir,"master.mp4");await writeFile(path,Buffer.from(await file.data.arrayBuffer()));
    // Local composers paste the reviewed photograph; anything else is treated as unknown provenance.
    const local=String(master.data.provider).startsWith("local");
    const verdict=critiqueVideo(await analyzeVideo(path),{storyboard:null,productPixels:local?"REAL_ASSET_COMPOSITE":"UNKNOWN"});
    const explanation={...(master.data.quality_explanation_json as Record<string,unknown>??{}),creativeCritic:{...verdict,signals:{...verdict.signals,frameHashes:verdict.signals.frameHashes.slice(0,64)},checkedAt:new Date().toISOString()}};
    const saved=await client.from("master_videos").update({quality_explanation_json:explanation}).eq("owner_id",owner).eq("id",masterId).select("id").maybeSingle();
    if(saved.error||!saved.data)throw new Error("VIDEO_CRITIC_SAVE_FAILED");
    return verdict;
  }finally{await rm(dir,{recursive:true,force:true})}
}
