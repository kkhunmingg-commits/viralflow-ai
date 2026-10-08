import type {SupabaseClient} from "@supabase/supabase-js";
import {z} from "zod";
import {loadOwnerAccountSafety} from "./store";

export function createAccountSafetyHandler(authenticate:()=>Promise<{client:SupabaseClient;ownerId:string}|null>) {
  return async(request:Request)=>{
    const session=await authenticate();
    if(!session)return Response.json({error:"authentication_required"},{status:401});
    const account=z.uuid().safeParse(new URL(request.url).searchParams.get("account"));
    if(!account.success)return Response.json({error:"account_not_found"},{status:404});
    const result=await session.client.from("tiktok_accounts").select("id").eq("owner_id",session.ownerId).eq("id",account.data).maybeSingle();
    if(result.error)return Response.json({error:"account_safety_unavailable"},{status:503});
    if(!result.data)return Response.json({error:"account_not_found"},{status:404});
    const aggregate=await loadOwnerAccountSafety(session.client,session.ownerId,[account.data]);
    return Response.json({accountId:account.data,safety:aggregate[account.data]},{headers:{"Cache-Control":"private, no-store"}});
  };
}
