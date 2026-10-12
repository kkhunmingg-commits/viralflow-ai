import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertMp4 } from "@/features/manual-post/package";
import { composeGeneratedVideo, validateNarrationAudio } from "@/features/video/media-composition";
import { FFmpegVideoRenderer } from "@/features/video/renderer";
import { extractVideoFrameEvidence, verifyVideoFrames, type FrameVisionProvider } from "@/features/video/frame-verification";
import { DeterministicVideoQualityEvaluator } from "@/features/video/quality";
import { videoStoragePath, ownsVideoStoragePath } from "@/features/video/storage";
import type { VideoRenderInput } from "@/features/video/types";
import type { ProviderId } from "./contracts";
export interface ProviderCreativeSource { project: Record<string,unknown>; product: Record<string,unknown>; script: Record<string,unknown>; angle: Record<string,unknown>; input: VideoRenderInput; }
function checked(result: {error:unknown}) { if (result.error) throw new Error("PROVIDER_STORAGE_FAILED"); }
export async function finalizeProviderMaster(admin: SupabaseClient, owner: string, job: {id:string;generation_job_id:string;tiktok_account_id:string;creative_project_id:string;provider:ProviderId;estimated_cost_usd:number},
  source: ProviderCreativeSource, bytes: Uint8Array, voice: Uint8Array | null, vision?: FrameVisionProvider) {
  if (!bytes.length || bytes.length > 50_000_000) throw new Error("VIDEO_SIZE_INVALID"); assertMp4(bytes,"video/mp4");
  if(voice)await validateNarrationAudio(new Blob([new Uint8Array(voice)]),8);
  const prior=await admin.from("master_videos").select("id,status,generation_job_id").eq("owner_id",owner).eq("creative_project_id",job.creative_project_id).maybeSingle(); checked(prior);
  if (prior.data && prior.data.generation_job_id!==job.generation_job_id) throw new Error("EXISTING_MASTER_REQUIRES_REVIEW");
  const asset = await admin.from("media_assets").select("storage_path").eq("owner_id",owner).eq("product_id",source.product.id).eq("asset_type","PRODUCT_IMAGE").in("source_type",["UPLOAD","PRODUCT"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
  checked(asset); if (!asset.data || !ownsVideoStoragePath(owner,asset.data.storage_path)) throw new Error("REAL_PRODUCT_IMAGE_REQUIRED");
  const reference = await admin.storage.from("video-assets").download(asset.data.storage_path); checked(reference);
  if (!reference.data || reference.data.size>12_000_000) throw new Error("REAL_PRODUCT_IMAGE_REQUIRED");
  const dir=join(tmpdir(),"viralflow-provider",job.id,randomUUID()); await mkdir(dir,{recursive:true});
  try {
    const sourcePath=join(dir,"source.mp4"), output=join(dir,"master.mp4"), image=join(dir,"reference"), audio=join(dir,"voice");
    await writeFile(sourcePath,bytes); await writeFile(image,new Uint8Array(await reference.data.arrayBuffer()));
    if (voice) await writeFile(audio,voice);
    const media = await new FFmpegVideoRenderer().probe(sourcePath);
    if (media.duration<7.88 || media.duration>30 || Math.abs(media.width/media.height-9/16)>.01) throw new Error("VIDEO_FORMAT_REVIEW");
    if (!voice && !media.hasAudio) throw new Error("REAL_AUDIO_REQUIRED");
    const composed=await composeGeneratedVideo(sourcePath,output,{durationSeconds:8,resolution:"1080p",overlay:[],voicePath:voice?audio:undefined,preserveAudio:!voice});
    const evidence=await extractVideoFrameEvidence(output,image,composed.media.duration);
    // No implicit paid vision call. Missing verified visual evidence remains REVIEW/RETRY.
    const visual=await verifyVideoFrames({...evidence,productTitle:String(source.product.title),expectedText:[String(source.script.cta_text??"")]},vision??null);
    const quality=new DeterministicVideoQualityEvaluator().evaluate({...composed.media,overlay:[],scenes:source.input.scenes,visualVerification:visual,
      productVisible:visual.productVisible,ctaVisible:visual.ctaVisible,malformedAssets:false,inheritedRisk:source.angle.policy_status as "SAFE"|"REVIEW"|"REJECT"});
    const path=videoStoragePath(owner,"masters",job.id,"provider-master.mp4"), result=new Uint8Array(await readFile(output));
    checked(await admin.storage.from("video-assets").upload(path,result,{contentType:"video/mp4",upsert:true}));
    const master=await admin.from("master_videos").upsert({id:prior.data?.id??randomUUID(),owner_id:owner,tiktok_account_id:job.tiktok_account_id,
      product_id:source.product.id,creative_project_id:job.creative_project_id,selected_script_id:source.script.id,generation_job_id:job.generation_job_id,
      provider:job.provider,model:job.provider==="google_vids_omni"?"OWNER_IMPORTED_VIDS": "ROUTED_FAL",render_strategy:"AI_IMAGE_TO_VIDEO",
      duration_seconds:composed.media.duration,width:composed.media.width,height:composed.media.height,fps:composed.media.fps,storage_path:path,
      quality_score:quality.score,quality_status:quality.status,quality_explanation_json:{...quality.explanation,assistedImport:job.provider==="google_vids_omni",sourceProvenance:job.provider==="google_vids_omni"?"OWNER_ATTESTED":"PROVIDER_RESPONSE",costBasis:job.provider==="google_vids_omni"?"UNKNOWN_ACCOUNT_QUOTA":"ESTIMATED_PENDING_BILLING",thaiNarrationVerified:false},
      estimated_cost_usd:job.estimated_cost_usd,status:quality.status==="REJECT"?"FAILED":"READY"},{onConflict:"owner_id,creative_project_id"}).select("id,quality_status").single(); checked(master);
    checked(await admin.from("media_assets").upsert({owner_id:owner,product_id:source.product.id,creative_project_id:job.creative_project_id,
      asset_type:"VIDEO",source_type:job.provider==="google_vids_omni"?"UPLOAD":"GENERATED",storage_path:path,mime_type:"video/mp4",provider:job.provider,
      width:composed.media.width,height:composed.media.height,duration_seconds:composed.media.duration,checksum:createHash("sha256").update(result).digest("hex")},{onConflict:"owner_id,storage_path"}));
    checked(await admin.from("generation_jobs").update({status:"COMPLETED",master_video_id:master.data!.id,output_json:{masterId:master.data!.id,quality,recordedCostUsd:null},completed_at:new Date().toISOString()}).eq("owner_id",owner).eq("id",job.generation_job_id));
    return master.data!;
  } finally {await rm(dir,{recursive:true,force:true});}
}
