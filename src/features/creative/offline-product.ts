import {randomUUID} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {assignmentDate} from "../assignments/planner";
import {assertProviderAdministrator} from "../video-provider/access";
import type {CreativeProjectRow} from "./types";
import {OFFLINE_PRODUCT_VERSION,isOfflineProductAssignment} from "./offline-policy";
/** Authenticated owner invokes this without changing TikTok authorization, scheduler opt-in or market scores. */
export async function createOfflineProductProject(client:SupabaseClient,owner:string,productId:string,accountId:string){
  const {data:auth}=await client.auth.getUser();if(auth.user?.id!==owner)throw new Error("OWNER_SESSION_REQUIRED");assertProviderAdministrator(auth.user);
  const [product,account]=await Promise.all([
    client.from("products").select("id,category_key").eq("owner_id",owner).eq("id",productId).maybeSingle(),
    client.from("tiktok_accounts").select("id,is_mock,authorization_status,effective_mode").eq("owner_id",owner).eq("id",accountId).maybeSingle(),
  ]);
  if(product.error||!product.data||account.error||!account.data||account.data.is_mock!==false||account.data.authorization_status!=="authorized"||account.data.effective_mode!=="GROWTH")throw new Error("OFFLINE_SOURCE_UNAVAILABLE");
  const now=new Date().toISOString(),date=assignmentDate(now);
  const current=await client.from("product_assignments").select("*").eq("owner_id",owner).eq("tiktok_account_id",accountId).eq("product_id",productId).eq("assignment_date",date).maybeSingle();
  if(current.error)throw new Error("OFFLINE_ASSIGNMENT_UNAVAILABLE");
  let assignment=current.data;
  if(assignment&&!isOfflineProductAssignment(assignment,owner))throw new Error("EXISTING_MARKET_ASSIGNMENT_REQUIRES_NORMAL_WORKFLOW");
  if(!assignment){
    const scoreId=randomUUID(),id=randomUUID(),runId=randomUUID();
    const reason={purpose:"OWNER_OFFLINE_PRODUCT",requestedBy:owner,requestedAt:now,marketMetrics:"UNKNOWN",plannerReason:"Owner requested an offline product showcase; no sales ranking, automatic execution, cart eligibility or publication authorized"};
    const score=await client.from("account_product_scores").insert({id:scoreId,owner_id:owner,tiktok_account_id:accountId,product_id:productId,category_id:null,run_id:runId,calculated_at:now,
      product_component:0,category_component:0,account_category_component:0,commercial_component:0,mode_fit_component:0,confidence_component:0,freshness_component:0,competition_component:0,
      account_product_fit_score:0,final_viral_opportunity_score:0,effective_mode:"GROWTH",eligible:false,score_version:OFFLINE_PRODUCT_VERSION,explanation_json:reason});
    if(score.error)throw new Error("OFFLINE_SELECTION_SAVE_FAILED");
    const insert=await client.from("product_assignments").insert({id,owner_id:owner,tiktok_account_id:accountId,product_id:productId,category_key:product.data.category_key,score_id:scoreId,
      assignment_date:date,rank_for_account:1,effective_mode:"GROWTH",final_score:0,status:"SELECTED",score_version:OFFLINE_PRODUCT_VERSION,reason_json:reason}).select("*").single();
    if(insert.error){
      // Another click can win the owner/account/product/day unique key; never create a second project.
      if(insert.error.code!=="23505")throw new Error("OFFLINE_SELECTION_SAVE_FAILED");
      const retry=await client.from("product_assignments").select("*").eq("owner_id",owner).eq("tiktok_account_id",accountId).eq("product_id",productId).eq("assignment_date",date).single();
      if(retry.error||!isOfflineProductAssignment(retry.data,owner))throw new Error("OFFLINE_SELECTION_CONFLICT");assignment=retry.data;
    }else assignment=insert.data;
  }
  const existing=await client.from("creative_projects").select("*").eq("owner_id",owner).eq("product_assignment_id",assignment.id).maybeSingle();
  if(existing.error)throw new Error("OFFLINE_PROJECT_UNAVAILABLE");if(existing.data)return existing.data as CreativeProjectRow;
  const project=await client.from("creative_projects").insert({owner_id:owner,tiktok_account_id:accountId,product_id:productId,product_assignment_id:assignment.id,mode:"GROWTH",status:"DRAFT"}).select("*").single();
  if(project.error){
    if(project.error.code!=="23505")throw new Error("OFFLINE_PROJECT_SAVE_FAILED");
    const retry=await client.from("creative_projects").select("*").eq("owner_id",owner).eq("product_assignment_id",assignment.id).single();
    if(retry.error)throw new Error("OFFLINE_PROJECT_SAVE_FAILED");return retry.data as CreativeProjectRow;
  }
  return project.data as CreativeProjectRow;
}
