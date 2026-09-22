"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {z} from "zod";
import {createClient} from "@/lib/supabase/server";
import {buildMasterVideo,buildVideoVariation,createVideoVariations,setVideoStatus} from "@/features/video/services";
import {runPrePublishGate} from "@/features/compliance/services";
import {enforceOwnerMutationRateLimit} from "@/lib/security/rate-limit";
const uuid=z.string().uuid();
async function auth(){const client=await createClient(),{data}=await client.auth.getUser();if(!data.user)throw new Error("Authentication required");await enforceOwnerMutationRateLimit("video-factory",data.user.id);return {client,owner:data.user.id}}
export async function createVideoFromCreativeAction(formData:FormData){
  const projectId=uuid.parse(formData.get("projectId")),{client,owner}=await auth(),master=await buildMasterVideo(client,owner,projectId);
  redirect(`/video-factory/${master.id}`);
}
export async function createVariationsAction(formData:FormData){
  const masterId=uuid.parse(formData.get("masterId")),{client,owner}=await auth();await createVideoVariations(client,owner,masterId,3);revalidatePath(`/video-factory/${masterId}`);
}
export async function renderVariationAction(formData:FormData){
  const masterId=uuid.parse(formData.get("masterId")),variationId=uuid.parse(formData.get("variationId")),{client,owner}=await auth();await buildVideoVariation(client,owner,variationId);revalidatePath(`/video-factory/${masterId}`);
}
export async function retryMasterAction(formData:FormData){
  const projectId=uuid.parse(formData.get("projectId")),masterId=uuid.parse(formData.get("masterId")),{client,owner}=await auth();await buildMasterVideo(client,owner,projectId);revalidatePath(`/video-factory/${masterId}`);
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
