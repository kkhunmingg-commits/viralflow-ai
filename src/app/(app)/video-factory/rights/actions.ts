"use server";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {enforceOwnerMutationRateLimit} from "@/lib/security/rate-limit";
import {addContentEvidence,contentEvidenceSchema,parseMediaRightsForm,readRightsProof,recordMediaRights,reviewMediaRights,revokeContentEvidence,revokeMediaRights} from "@/features/video/media-rights-service";
const uuid=z.string().uuid();
async function auth(){const userClient=await createClient(),{data}=await userClient.auth.getUser();if(!data.user)throw new Error("Authentication required");await enforceOwnerMutationRateLimit("media-rights",data.user.id);return {client:createAdminClient(),owner:data.user.id}}
const done=()=>revalidatePath("/video-factory/rights");
export async function recordMediaRightsAction(formData:FormData){
  const input=parseMediaRightsForm(formData),proof=await readRightsProof(formData.get("proof")),{client,owner}=await auth();
  await recordMediaRights(client,owner,input,proof);done();
}
export async function reviewMediaRightsAction(formData:FormData){
  const id=uuid.parse(formData.get("rightsId")),decision=z.enum(["APPROVED","REJECTED"]).parse(formData.get("decision"));
  z.literal("on").parse(formData.get("confirmed"));const {client,owner}=await auth();await reviewMediaRights(client,owner,id,decision);done();
}
export async function revokeMediaRightsAction(formData:FormData){
  const id=uuid.parse(formData.get("rightsId")),{client,owner}=await auth();await revokeMediaRights(client,owner,id,String(formData.get("reason")??""));done();
}
export async function addContentEvidenceAction(formData:FormData){
  const role=formData.get("role"),input=contentEvidenceSchema.parse({productId:formData.get("productId"),statement:formData.get("statement"),source:formData.get("source"),
    sourceReference:formData.get("sourceReference"),role:role?role:null,capturedAt:formData.get("capturedAt")});
  const {client,owner}=await auth();await addContentEvidence(client,owner,input);done();
}
export async function revokeContentEvidenceAction(formData:FormData){
  const id=uuid.parse(formData.get("evidenceId")),{client,owner}=await auth();await revokeContentEvidence(client,owner,id);done();
}
