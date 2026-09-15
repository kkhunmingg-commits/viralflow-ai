"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assignmentDate } from "@/features/assignments/planner";
import { persistDailyAssignments } from "@/features/assignments/services";
import { createProjectFromAssignment,generateCreativeProject,rejectScript,selectCreative,updateScript } from "@/features/creative/services";
const uuid=z.string().uuid();
async function auth(){
  const client=await createClient(),{data}=await client.auth.getUser();
  if(!data.user)throw new Error("Authentication required");return {client,owner:data.user.id};
}
export async function createCreativeFromRecommendation(formData:FormData){
  const accountId=uuid.parse(formData.get("accountId")),productId=uuid.parse(formData.get("productId"));
  const {client,owner}=await auth();const date=assignmentDate(new Date().toISOString());
  let query=await client.from("product_assignments").select("id").eq("owner_id",owner).eq("tiktok_account_id",accountId).eq("product_id",productId).eq("assignment_date",date).in("status",["CANDIDATE","SELECTED","USED"]).maybeSingle();
  if(query.error)throw new Error(query.error.message);
  if(!query.data){await persistDailyAssignments(client,owner);query=await client.from("product_assignments").select("id").eq("owner_id",owner).eq("tiktok_account_id",accountId).eq("product_id",productId).eq("assignment_date",date).in("status",["CANDIDATE","SELECTED","USED"]).maybeSingle();}
  if(query.error||!query.data)throw new Error(query.error?.message??"This pair is not in the active daily plan");
  const project=await createProjectFromAssignment(client,owner,query.data.id);
  await generateCreativeProject(client,owner,project.id);
  redirect(`/creative-studio/${project.id}`);
}
export async function generateCreativeAction(formData:FormData){
  const projectId=uuid.parse(formData.get("projectId"));const {client,owner}=await auth();
  await generateCreativeProject(client,owner,projectId);revalidatePath(`/creative-studio/${projectId}`);
}
export async function selectCreativeAction(formData:FormData){
  const projectId=uuid.parse(formData.get("projectId")),angleId=uuid.parse(formData.get("angleId")),scriptId=uuid.parse(formData.get("scriptId"));
  const {client,owner}=await auth();await selectCreative(client,owner,projectId,angleId,scriptId);revalidatePath(`/creative-studio/${projectId}`);
}
export async function rejectCreativeAction(formData:FormData){
  const projectId=uuid.parse(formData.get("projectId")),scriptId=uuid.parse(formData.get("scriptId"));
  const {client,owner}=await auth();await rejectScript(client,owner,scriptId);revalidatePath(`/creative-studio/${projectId}`);
}
export async function editCreativeAction(formData:FormData){
  const projectId=uuid.parse(formData.get("projectId")),scriptId=uuid.parse(formData.get("scriptId"));
  const values=z.object({voice_script:z.string().min(1).max(180),cta_text:z.string().min(1).max(100),caption:z.string().min(1).max(300)}).parse(Object.fromEntries(formData));
  const {client,owner}=await auth();await updateScript(client,owner,scriptId,values);revalidatePath(`/creative-studio/${projectId}`);
}
