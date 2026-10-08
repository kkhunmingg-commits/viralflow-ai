import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {enforceOwnerMutationRateLimit} from "@/lib/security/rate-limit";
import {createPolicyAdminHandlers} from "@/features/compliance-brain/admin-api";
import {readPolicyTrustKeys} from "@/features/compliance-brain/server-runtime";
import {verifySignedPolicyPack} from "@/features/compliance-brain/policy-pack";
const handlers=createPolicyAdminHandlers({authenticate:async()=>{
  const client=await createClient();const {data,error}=await client.auth.getUser();return !error&&data.user?data.user:null;
},adminClient:createAdminClient,verify:pack=>verifySignedPolicyPack(pack,readPolicyTrustKeys()),
rateLimit:ownerId=>enforceOwnerMutationRateLimit("compliance-policy",ownerId)});
export const GET=handlers.GET;
export const POST=handlers.POST;
