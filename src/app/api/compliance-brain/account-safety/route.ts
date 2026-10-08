import {createClient} from "@/lib/supabase/server";
import {createAccountSafetyHandler} from "@/features/compliance-brain/customer-api";
export const GET=createAccountSafetyHandler(async()=>{
  const client=await createClient();const {data,error}=await client.auth.getUser();
  return !error&&data.user?{client,ownerId:data.user.id}:null;
});
