import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {enforceOwnerMutationRateLimit} from "@/lib/security/rate-limit";
import {createLearningAdminHandler} from "@/features/compliance-brain/learning-admin-api";

export const POST=createLearningAdminHandler({authenticate:async()=>{
  const client=await createClient();
  const {data,error}=await client.auth.getUser();
  return !error&&data.user?data.user:null;
},adminClient:createAdminClient,rateLimit:ownerId=>enforceOwnerMutationRateLimit("compliance-learning",ownerId)});
