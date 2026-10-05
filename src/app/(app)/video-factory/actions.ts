"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {z} from "zod";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {buildMasterVideo,buildVideoVariation,createVideoVariations,setVideoStatus} from "@/features/video/services";
import {runPrePublishGate} from "@/features/compliance/services";
import {enforceOwnerMutationRateLimit} from "@/lib/security/rate-limit";
import {FalGenerationPendingError,reverifyAutoFalMaster,cancelVideoFactoryGeneration} from "@/features/video/auto-fal";
import {uploadVideoFactorySource} from "@/features/video/source-uploads";
const uuid=z.string().uuid();
async function auth(){const userClient=await createClient(),{data}=await userClient.auth.getUser();if(!data.user)throw new Error("Authentication required");await enforceOwnerMutationRateLimit("video-factory",data.user.id);return {client:createAdminClient(),owner:data.user.id}}
export async function createVideoFromCreativeAction(formData:FormData){
  const projectId=uuid.parse(formData.get("projectId")),{client,owner}=await auth();
  let master;
  try{master=await buildMasterVideo(client,owner,projectId)}catch(error){redirect(`/video-factory?status=${error instanceof FalGenerationPendingError?"pending":"review"}`)}
  redirect(`/video-factory/${master.id}`);
}
export async function createVariationsAction(formData:FormData){
  const masterId=uuid.parse(formData.get("masterId")),{client,owner}=await auth();await createVideoVariations(client,owner,masterId,3);revalidatePath(`/video-factory/${masterId}`);
}
export async function renderVariationAction(formData:FormData){
  const masterId=uuid.parse(formData.get("masterId")),variationId=uuid.parse(formData.get("variationId")),{client,owner}=await auth();await buildVideoVariation(client,owner,variationId);revalidatePath(`/video-factory/${masterId}`);
}
export async function retryMasterAction(formData:FormData){
  const projectId=uuid.parse(formData.get("projectId")),masterId=uuid.parse(formData.get("masterId")),{client,owner}=await auth();
  const master=await client.from("master_videos").select("provider,storage_path,tiktok_account_id,creative_project_id").eq("owner_id",owner).eq("id",masterId).maybeSingle();
  if(master.error||!master.data||master.data.creative_project_id!==projectId)throw new Error("Video unavailable");
  try{
    if(master.data.provider==="fal"&&master.data.storage_path)await reverifyAutoFalMaster(client,{ownerId:owner,accountId:master.data.tiktok_account_id,projectId,videoId:masterId});
    else await buildMasterVideo(client,owner,projectId);
  }catch{redirect(`/video-factory/${masterId}?status=review`)}
  revalidatePath(`/video-factory/${masterId}`);
}
export async function cancelVideoGenerationAction(formData:FormData){
  const masterId=uuid.parse(formData.get("masterId")),{client,owner}=await auth();
  await cancelVideoFactoryGeneration(client,owner,masterId);revalidatePath(`/video-factory/${masterId}`);revalidatePath("/video-factory");
}
export async function uploadVideoSourceAction(formData:FormData){
  const {client,owner}=await auth(),masterId=uuid.parse(formData.get("masterId"));
  const kind=z.enum(["PRODUCT_IMAGE","VOICE"]).parse(formData.get("kind")),file=formData.get("file");
  try{
    if(!(file instanceof File))throw new Error("source_file_required");
    await uploadVideoFactorySource(client,owner,masterId,kind,file);
  }catch{redirect(`/video-factory/${masterId}?asset=error`)}
  revalidatePath(`/video-factory/${masterId}`);
  redirect(`/video-factory/${masterId}?asset=ready`);
}
export async function setVideoStatusAction(formData:FormData){
  const id=uuid.parse(formData.get("id")),masterId=uuid.parse(formData.get("masterId")),kind=z.enum(["master","variation"]).parse(formData.get("kind")),status=z.enum(["APPROVED","REJECTED"]).parse(formData.get("status")),{client,owner}=await auth();
  if(status==="APPROVED"){
    const gate=await runPrePublishGate(client,owner,kind,id,true);
    if(!["READY_FOR_REVIEW","READY_TO_PUBLISH"].includes(gate.eligibility.finalStatus))throw new Error(`Pre-publish gate blocked approval: ${gate.eligibility.finalStatus}`);
  }
  await setVideoStatus(client,owner,kind,id,status);revalidatePath(`/video-factory/${masterId}`);
  revalidatePath("/compliance");
}
