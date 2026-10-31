import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {createAdminClient} from "@/lib/supabase/admin";
import {buildShoppableIntent,checkShopProductTruth,evaluateAccountProductCommerce} from "./readiness";
import type {CreatorCommerceProfile,ProductPermission,ShopProduct} from "./types";

type Row=Record<string,unknown>;
const text=(value:unknown)=>String(value??"");
function profile(row:Row):CreatorCommerceProfile{return {accountId:text(row.tiktok_account_id),region:text(row.region),followerCount:Number(row.follower_count??0),affiliateEligible:Boolean(row.affiliate_eligible),ecommercePermission:Boolean(row.ecommerce_permission),cartPermission:Boolean(row.cart_permission),showcaseAvailable:Boolean(row.showcase_available),attachmentAvailable:Boolean(row.attachment_available),authorizationStatus:text(row.authorization_status) as CreatorCommerceProfile["authorizationStatus"]}}
function product(row:Row):ShopProduct{return {id:text(row.id),externalProductId:text(row.external_product_id),linkedProductId:row.product_id?text(row.product_id):null,region:text(row.region),title:text(row.title),sellerName:row.seller_name?text(row.seller_name):null,sellerStatus:text(row.seller_status) as ShopProduct["sellerStatus"],currency:text(row.currency),currentPrice:Number(row.current_price),originalPrice:row.original_price===null?null:Number(row.original_price),commissionRate:row.commission_rate===null?null:Number(row.commission_rate),productStatus:text(row.product_status) as ShopProduct["productStatus"],collaborationStatus:text(row.collaboration_status) as ShopProduct["collaborationStatus"],auditStatus:text(row.audit_status) as ShopProduct["auditStatus"],features:Array.isArray((row.provider_metadata as Row)?.features)?(row.provider_metadata as Row).features as string[]:[]}}
function permission(row:Row):ProductPermission{return {status:text(row.permission_status) as ProductPermission["status"],canAddToShowcase:Boolean(row.can_add_to_showcase),canAttachToVideo:Boolean(row.can_attach_to_video),blockers:Array.isArray(row.blockers_json)?row.blockers_json.map(text):[]}}

export async function getCommerceOverview(client:SupabaseClient,ownerId:string){
  const [accounts,connections,profiles,products,permissions,eligibility]=await Promise.all([
    client.from("tiktok_accounts").select("id,display_name,username,follower_count,mode,effective_mode,shop_creator_eligible,ecommerce_permission,cart_enabled").eq("owner_id",ownerId).order("created_at"),
    client.from("tiktok_shop_connections").select("*").eq("owner_id",ownerId).order("updated_at",{ascending:false}),
    client.from("creator_commerce_profiles").select("*").eq("owner_id",ownerId),
    client.from("shop_products").select("*").eq("owner_id",ownerId).order("last_seen_at",{ascending:false}),
    client.from("shop_product_permissions").select("*").eq("owner_id",ownerId),
    client.from("account_product_commerce_eligibility").select("*").eq("owner_id",ownerId).order("evaluated_at",{ascending:false}),
  ]);for(const result of [accounts,connections,profiles,products,permissions,eligibility])if(result.error)throw new Error(result.error.message);
  const connectionMap=new Map((connections.data??[]).map(v=>[v.tiktok_account_id,v])),profileMap=new Map((profiles.data??[]).map(v=>[v.tiktok_account_id,v]));
  return {accounts:(accounts.data??[]).map(a=>({...a,connection:connectionMap.get(a.id)??null,commerce_profile:profileMap.get(a.id)??null})),products:products.data??[],permissions:permissions.data??[],eligibility:eligibility.data??[]};
}

export async function getCommerceAccount(client:SupabaseClient,ownerId:string,accountId:string){const overview=await getCommerceOverview(client,ownerId),account=overview.accounts.find(a=>a.id===accountId);if(!account)return null;return {...overview,account,permissions:overview.permissions.filter(p=>p.tiktok_account_id===accountId),eligibility:overview.eligibility.filter(e=>e.tiktok_account_id===accountId)}}

export async function createShoppableIntentForQueue(ownerId:string,queueId:string,shopProductId:string,admin:SupabaseClient=createAdminClient()){
  const {data:queue,error:queueError}=await admin.from("publishing_queue").select("*").eq("owner_id",ownerId).eq("id",queueId).maybeSingle();if(queueError||!queue)throw new Error("publish_queue_not_found");
  if(!queue.compliance_check_id)throw new Error("commerce_compliance_required");
  const videoTable=queue.video_kind==="MASTER"?"master_videos":"video_variations";
  const [accountResult,videoResult,shopResult,profileResult,connectionResult,permissionResult,complianceResult]=await Promise.all([
    admin.from("tiktok_accounts").select("*").eq("owner_id",ownerId).eq("id",queue.tiktok_account_id).single(),admin.from(videoTable).select("product_id").eq("owner_id",ownerId).eq("id",queue.video_id).single(),admin.from("shop_products").select("*").eq("owner_id",ownerId).eq("id",shopProductId).single(),admin.from("creator_commerce_profiles").select("*").eq("owner_id",ownerId).eq("tiktok_account_id",queue.tiktok_account_id).single(),admin.from("tiktok_shop_connections").select("authorization_status").eq("owner_id",ownerId).eq("tiktok_account_id",queue.tiktok_account_id).eq("authorization_type","CREATOR").single(),admin.from("shop_product_permissions").select("*").eq("owner_id",ownerId).eq("tiktok_account_id",queue.tiktok_account_id).eq("shop_product_id",shopProductId).single(),admin.from("content_compliance_checks").select("overall_status,product_truth_status").eq("owner_id",ownerId).eq("id",queue.compliance_check_id).single(),
  ]);for(const result of [accountResult,videoResult,shopResult,profileResult,connectionResult,permissionResult,complianceResult])if(result.error||!result.data)throw new Error("commerce_context_incomplete");
  const account=accountResult.data,video=videoResult.data,shop=shopResult.data,commerceProfileRow=profileResult.data,connection=connectionResult.data,permissionRow=permissionResult.data,compliance=complianceResult.data;
  if(!account||!video||!shop||!commerceProfileRow||!connection||!permissionRow||!compliance)throw new Error("commerce_context_incomplete");
  if(compliance.overall_status!=="PASS"||compliance.product_truth_status!=="PASS")throw new Error("commerce_compliance_not_passed");
  if(shop.product_id!==video.product_id)throw new Error("shop_product_video_product_mismatch");
  const {data:radar,error:radarError}=await admin.from("products").select("*").eq("owner_id",ownerId).eq("id",video.product_id).single();if(radarError||!radar)throw new Error("radar_product_not_found");
  const rawProfile={...commerceProfileRow,follower_count:account.follower_count,authorization_status:connection.authorization_status},commerceProfile=profile(rawProfile),shopProduct=product(shop),productPermission=permission(permissionRow);
  const evaluated=evaluateAccountProductCommerce({requestedMode:account.mode,profile:commerceProfile,product:shopProduct,permission:productPermission,contentFit:true}),truth=checkShopProductTruth({radarTitle:radar.title,radarPrice:Number(radar.current_price),radarOriginalPrice:radar.original_price===null?null:Number(radar.original_price),radarStatus:radar.status,shopProduct,claimedFeatures:[]}),intent=buildShoppableIntent({eligibility:evaluated,truth,product:shopProduct});
  const {data:eligibility,error:eligibilityError}=await admin.from("account_product_commerce_eligibility").insert({owner_id:ownerId,tiktok_account_id:queue.tiktok_account_id,shop_product_id:shopProductId,content_fit:evaluated.contentFit,commerce_eligible:evaluated.commerceEligible,account_ready:evaluated.accountReady,product_eligible:evaluated.productEligible,attachment_allowed:evaluated.attachmentAllowed,region_match:evaluated.regionMatch,status:evaluated.status,blockers_json:evaluated.blockers}).select("id").single();if(eligibilityError||!eligibility)throw new Error("commerce_eligibility_write_failed");
  const {data:intentRow,error:intentError}=await admin.from("shoppable_content_intents").insert({owner_id:ownerId,tiktok_account_id:queue.tiktok_account_id,shop_product_id:shopProductId,publishing_queue_id:queueId,commerce_eligibility_id:eligibility.id,intent_type:intent.type,status:intent.status,product_truth_status:intent.productTruthStatus,metadata_json:intent.metadata,blockers_json:intent.blockers}).select("*").single();if(intentError||!intentRow)throw new Error("shoppable_intent_write_failed");
  const commercial={...(queue.commercial_content_json as Row),shoppable_content_intent:true};const {error:updateError}=await admin.from("publishing_queue").update({shoppable_content_intent_id:intentRow.id,commercial_content_json:commercial}).eq("owner_id",ownerId).eq("id",queueId);if(updateError)throw new Error("publishing_queue_commerce_link_failed");return intentRow;
}

export async function assertShoppableIntentReady(admin:SupabaseClient,ownerId:string,intentId:string){
  const {data,error}=await admin.from("shoppable_content_intents").select("status,product_truth_status,blockers_json,tiktok_account_id,shop_product_id").eq("owner_id",ownerId).eq("id",intentId).maybeSingle();if(error||!data)throw new Error("shoppable_intent_not_found");if(data.status!=="READY_FOR_REVIEW"||data.product_truth_status!=="PASS")throw new Error("shoppable_intent_blocked");
  const [accountResult,profileResult,connectionResult,productResult,permissionResult]=await Promise.all([
    admin.from("tiktok_accounts").select("mode,follower_count").eq("owner_id",ownerId).eq("id",data.tiktok_account_id).single(),
    admin.from("creator_commerce_profiles").select("*").eq("owner_id",ownerId).eq("tiktok_account_id",data.tiktok_account_id).single(),
    admin.from("tiktok_shop_connections").select("authorization_status").eq("owner_id",ownerId).eq("tiktok_account_id",data.tiktok_account_id).eq("authorization_type","CREATOR").single(),
    admin.from("shop_products").select("*").eq("owner_id",ownerId).eq("id",data.shop_product_id).single(),
    admin.from("shop_product_permissions").select("*").eq("owner_id",ownerId).eq("tiktok_account_id",data.tiktok_account_id).eq("shop_product_id",data.shop_product_id).single(),
  ]);for(const result of [accountResult,profileResult,connectionResult,productResult,permissionResult])if(result.error||!result.data)throw new Error("shoppable_intent_context_incomplete");
  const account=accountResult.data,profileRow=profileResult.data,connection=connectionResult.data,productRow=productResult.data,permissionRow=permissionResult.data;if(!account||!profileRow||!connection||!productRow||!permissionRow)throw new Error("shoppable_intent_context_incomplete");
  const current=evaluateAccountProductCommerce({requestedMode:account.mode,profile:profile({...profileRow,follower_count:account.follower_count,authorization_status:connection.authorization_status}),product:product(productRow),permission:permission(permissionRow),contentFit:true});
  if(!current.commerceEligible||current.status!=="ELIGIBLE")throw new Error("shoppable_intent_stale_or_blocked");return data;
}
