import "server-only";
import {createClient} from "@/lib/supabase/server";
import {loadOwnerAccountSafety} from "./store";
import {unavailableAccountSafety} from "./presentation";

export async function getCustomerAccountSafety(accountIds:readonly string[]) {
  if(!accountIds.length)return {};
  const fallback=Object.fromEntries(accountIds.map(id=>[id,unavailableAccountSafety()]));
  const client=await createClient();
  const {data,error}=await client.auth.getUser();
  if(error||!data.user)return fallback;
  const accounts=await client.from("tiktok_accounts").select("id").eq("owner_id",data.user.id).in("id",[...accountIds]);
  if(accounts.error)return fallback;
  const allowed=(accounts.data??[]).map(row=>row.id as string);
  return {...fallback,...await loadOwnerAccountSafety(client,data.user.id,allowed)};
}
