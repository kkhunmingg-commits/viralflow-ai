import type { TikTokAccount } from "@/features/accounts/types";
import type { AssignmentInput, ProductEvidence } from "./types";

export function assignmentFixtures(now = "2026-09-15T09:00:00.000Z", owner = "fixture-owner"): AssignmentInput {
  const accounts: TikTokAccount[] = ["A","B","C"].map((id,index)=>({
    id, owner_id:owner, display_name:"Account "+id, username:"fixture."+id,
    follower_count:index?2500:620, following_count:100, mode:index?"AFFILIATE":"GROWTH",
    effective_mode:index?"AFFILIATE":"GROWTH", shop_creator_eligible:!!index,
    ecommerce_permission:!!index, cart_enabled:!!index, daily_post_target:2, daily_post_hard_limit:3,
    account_status:"active", authorization_status:"authorized", preferred_categories:[["beauty","home","gadgets"][index]],
    account_notes:null, last_synced_at:now, is_mock:true, created_at:now, updated_at:now,
  }));
  const definitions = [
    ["P1","beauty",96,96,8,80,.8,.9],
    ["P2","beauty",88,94,40,85,.6,.9],
    ["P3","home",72,75,98,96,.5,.95],
    ["P4","home",95,85,2,60,.7,.9],
    ["P5","gadgets",82,80,95,90,.6,.95],
    ["P6","fashion",99,90,70,75,.9,.9],
    ["P7","beauty",100,95,90,80,2.9,.1],
  ] as const;
  const products: ProductEvidence[] = definitions.map(([id,key,momentum,creative,commission,price,acceleration,confidence])=>({
    product: {id,owner_id:owner,external_provider:"mock",external_product_id:id,slug:id.toLowerCase(),title:id+" "+key,
      category_key:key,image_url:null,product_url:null,currency:"THB",current_price:500,original_price:600,
      commission_rate:commission/1000,commission_amount:commission/2,rating:4.7,review_count:800,
      units_sold:1000,status:"available",provider_metadata:{fixture:"phase5a"},first_seen_at:now,last_seen_at:now,created_at:now,updated_at:now},
    momentum,creative,commission,price,acceleration,confidence,observedAt:now,competition:.2,trend:id==="P7"?"LOW_DATA":"ACCELERATING",
  }));
  const categories=["beauty","home","gadgets","fashion"].map((key,index)=>({
    id:"cat-"+key,key,provider:"mock",active:true,momentum:[90,72,80,50][index],
    commercial:[50,95,92,60][index],confidence:.9,saturation:.2,observedAt:now,
  }));
  const affinities=accounts.flatMap((account,index)=>categories.map((c,i)=>({
    accountId:account.id,categoryKey:c.key,score:index===i?.95:.05,confidence:.95,
  })));
  return {accounts,products,categories,affinities,now};
}
