"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {z} from "zod";
import {createClient} from "@/lib/supabase/server";
import {buildMasterVideo,buildVideoVariation,createVideoVariations,setVideoStatus} from "@/features/video/services";
const uuid=z.string().uuid();
async function auth(){const client=await createClient(),{data}=await client.auth.getUser();if(!data.user)throw new Error("Authentication required");return {client,owner:data.user.id}}
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
  await setVideoStatus(client,owner,kind,id,status);revalidatePath(`/video-factory/${masterId}`);
}
