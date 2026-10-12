import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {accountAutoPermission} from "./discovery-service";
import {createProjectFromAssignment} from "../creative/services";
import {assignmentDate} from "../assignments/planner";

/** Continue into existing account-specific Assignment → Creative Brain, without enabling spend or attachments. */
export async function prepareAffiliateHandoff(admin:SupabaseClient,owner:string,account:string,now=new Date()){
 const permission=await accountAutoPermission(admin,owner,account);
 if(permission?.mode!=="AFFILIATE"||!permission.affiliate_allowed)return {stage:"WAITING_FOR_ELIGIBILITY"};
 const pilot=await admin.from("growth_pilot_allowlist").select("enabled").eq("owner_id",owner).eq("tiktok_account_id",account).eq("enabled",true).maybeSingle();
 if(pilot.error)throw new Error("GROWTH_STORAGE_UNAVAILABLE");if(!pilot.data)return {stage:"NOT_ENROLLED"};
 for(let offset=0;;offset+=500){
  const candidates=await admin.from("product_assignments").select("id,product_id").eq("owner_id",owner).eq("tiktok_account_id",account)
   .eq("assignment_date",assignmentDate(now.toISOString())).eq("effective_mode","AFFILIATE").in("status",["CANDIDATE","SELECTED"]).gt("final_score",0)
   .order("rank_for_account").order("id").range(offset,offset+499);
  if(candidates.error)throw new Error("GROWTH_STORAGE_UNAVAILABLE");
  for(const assignment of candidates.data??[]){
   const product=await admin.from("products").select("external_provider,status,last_seen_at").eq("owner_id",owner).eq("id",assignment.product_id).maybeSingle();
   if(product.error)throw new Error("GROWTH_STORAGE_UNAVAILABLE");
   const p=product.data;if(!p||p.external_provider!=="tiktok_shop"||p.status!=="available"||Date.parse(p.last_seen_at)>now.getTime()||!(Date.parse(p.last_seen_at)>=now.getTime()-48*3600000))continue;
   // Existing owner+assignment uniqueness keeps restart/concurrent retries from duplicating a project.
   await createProjectFromAssignment(admin,owner,assignment.id);
   return {stage:"CREATIVE_REQUIRED"};
  }
  if((candidates.data?.length??0)<500)return {stage:"WAITING_FOR_REAL_PRODUCT_ASSIGNMENT"};
 }
}
