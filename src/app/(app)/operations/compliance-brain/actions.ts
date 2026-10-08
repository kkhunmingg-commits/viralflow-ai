"use server";
import {revalidatePath} from "next/cache";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {enforceOwnerMutationRateLimit} from "@/lib/security/rate-limit";
import {applyPolicyCommand} from "@/features/compliance-brain/admin-api";
import {requirePolicyAdmin} from "@/features/compliance-brain/store";
import {readPolicyTrustKeys} from "@/features/compliance-brain/server-runtime";
import {verifySignedPolicyPack} from "@/features/compliance-brain/policy-pack";
export async function policyCommandAction(form:FormData){
  const client=await createClient();const {data,error}=await client.auth.getUser();
  if(error||!data.user)throw new Error("compliance_admin_required");
  const actor=requirePolicyAdmin(data.user);
  await enforceOwnerMutationRateLimit("compliance-policy",actor.id);
  await applyPolicyCommand(createAdminClient(),actor,{action:form.get("action"),version:form.get("version")},
    pack=>verifySignedPolicyPack(pack,readPolicyTrustKeys()));
  revalidatePath("/operations/compliance-brain");
}
