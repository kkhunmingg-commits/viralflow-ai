import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {commerceProducts as products,commerceProfiles as profiles,allowedPermission,blockedPermission} from "./fixtures";
import {MockTikTokShopProvider,TikTokShopApprovalRequiredProvider} from "./provider";
import {buildShoppableIntent,calculateCommerceStatus,checkShopProductTruth,evaluateAccountProductCommerce,resolveEffectiveCommerceMode,validateCommerceCta} from "./readiness";

describe("commerce readiness A-I",()=>{
  it("preserves Growth below 1,000 followers",()=>{expect(calculateCommerceStatus(profiles.A).status).toBe("GROWTH");expect(resolveEffectiveCommerceMode("AUTO",profiles.A)).toBe("GROWTH")});
  it(">=1,000 followers does not imply Affiliate",()=>{expect(calculateCommerceStatus(profiles.B).status).toBe("FOLLOWER_READY_NO_COMMERCE");expect(resolveEffectiveCommerceMode("AFFILIATE",profiles.B)).toBe("GROWTH")});
  it("missing cart keeps commerce blocked",()=>{expect(calculateCommerceStatus(profiles.C).status).toBe("COMMERCE_BLOCKED");expect(resolveEffectiveCommerceMode("AUTO",profiles.C)).toBe("GROWTH")});
  it("full actual readiness enables Affiliate",()=>{expect(calculateCommerceStatus(profiles.D).status).toBe("AFFILIATE_READY");expect(resolveEffectiveCommerceMode("AUTO",profiles.D)).toBe("AFFILIATE")});
  it("revoked Shop authorization requires reauth",()=>expect(calculateCommerceStatus(profiles.I).status).toBe("REAUTH_REQUIRED"));
  it("Growth content remains eligible without Shop",()=>{const result=evaluateAccountProductCommerce({requestedMode:"AUTO",profile:profiles.A,product:products.H,permission:blockedPermission,contentFit:true});expect(result.status).toBe("CONTENT_ONLY");expect(result.contentFit).toBe(true);expect(result.commerceEligible).toBe(false)});
  it("blocks Affiliate and fake cart CTA without permission",()=>{expect(validateCommerceCta({mode:"GROWTH",text:"กดตะกร้าเลย"})).toEqual({allowed:false,reason:"GROWTH_SHOP_CTA_BLOCKED"});expect(validateCommerceCta({mode:"AFFILIATE",text:"ซื้อเลย"})).toEqual({allowed:false,reason:"COMMERCE_PERMISSION_REQUIRED"})});
  it("rejects inactive, disallowed, and region-mismatched products",()=>{for(const [product,permission] of [[products.E,allowedPermission],[products.F,blockedPermission],[products.G,allowedPermission]] as const){expect(evaluateAccountProductCommerce({requestedMode:"AUTO",profile:profiles.D,product,permission,contentFit:true}).commerceEligible).toBe(false)}});
  it("allows fully eligible account-product pair",()=>expect(evaluateAccountProductCommerce({requestedMode:"AUTO",profile:profiles.D,product:products.H,permission:allowedPermission,contentFit:true}).status).toBe("ELIGIBLE"));
  it("rejects product truth mismatches",()=>expect(checkShopProductTruth({radarTitle:"สินค้าอื่น",radarPrice:199,radarOriginalPrice:399,radarStatus:"available",shopProduct:products.H,claimedFeatures:["รักษาโรค"]}).status).toBe("REJECT"));
  it("rejects an inactive seller even when the product row is active",()=>expect(checkShopProductTruth({radarTitle:products.H.title,radarPrice:299,radarOriginalPrice:399,radarStatus:"available",shopProduct:{...products.H,sellerStatus:"SUSPENDED"}}).blockers).toContain("SELLER_NOT_ACTIVE"));
  it("creates metadata-only intent after truth and commerce pass",()=>{const eligibility=evaluateAccountProductCommerce({requestedMode:"AUTO",profile:profiles.D,product:products.H,permission:allowedPermission,contentFit:true}),truth=checkShopProductTruth({radarTitle:products.H.title,radarPrice:299,radarOriginalPrice:399,radarStatus:"available",shopProduct:products.H,claimedFeatures:["เนื้อบางเบา"]}),intent=buildShoppableIntent({eligibility,truth,product:products.H});expect(intent.status).toBe("READY_FOR_REVIEW");expect(intent.metadata.attachmentPerformed).toBe(false)});
});

describe("providers and scale",()=>{
  it("mock provider is deterministic and real provider is approval-gated",async()=>{const mock=new MockTikTokShopProvider(Object.values(profiles),Object.values(products),{"D:H":allowedPermission});expect(await mock.listEligibleProducts("D")).toHaveLength(2);await expect(new TikTokShopApprovalRequiredProvider().getAuthorizationStatus()).rejects.toThrow("approval_required")});
  it("does not serialize access, refresh, shop, or app secrets",async()=>{const value=await new MockTikTokShopProvider([profiles.D],[products.H],{"D:H":allowedPermission}).getAuthorizationStatus("D"),serialized=JSON.stringify(value);for(const secret of ["access_token","refresh_token","shop_secret","app_secret"])expect(serialized).not.toContain(secret)});
  it("simulates 10 accounts with 4 Growth, 3 blocked, and 3 Affiliate-ready",()=>{const inputs=[...Array(4).fill(profiles.A),...Array(3).fill(profiles.B),...Array(3).fill(profiles.D)],results=inputs.map((profile,index)=>evaluateAccountProductCommerce({requestedMode:"AUTO",profile:{...profile,accountId:`scale-${index}`},product:products.H,permission:allowedPermission,contentFit:true}));expect(results.filter(r=>r.status==="CONTENT_ONLY")).toHaveLength(7);expect(results.filter(r=>r.status==="ELIGIBLE")).toHaveLength(3);expect(results.every(r=>r.contentFit)).toBe(true)});
});

describe("Phase 7C migration",()=>{
  const sql=readFileSync("supabase/migrations/20260918021720_phase_7c_tiktok_shop_foundation.sql","utf8"),tables=["tiktok_shop_connections","creator_commerce_profiles","shop_products","shop_product_snapshots","shop_product_permissions","account_product_commerce_eligibility","shoppable_content_intents"];
  it("creates one owner-scoped RLS schema",()=>{for(const table of tables){expect(sql).toContain(`create table public.${table}`);expect(sql).toContain(`alter table public.${table} enable row level security`);expect(sql).toContain(`on public.${table} for select to authenticated using((select auth.uid())=owner_id)`)}});
  it("keeps snapshots and eligibility append-only for browser roles",()=>{expect(sql).toContain("grant select on public.tiktok_shop_connections");expect(sql).not.toMatch(/grant select,insert[^;]+authenticated/);expect(sql).toContain("Metadata intent only")});
  it("requires real commerce facts for generated effective mode",()=>{expect(sql).toContain("is_shop_creator_eligible is true");expect(sql).toContain("has_ecommerce_permission is true");expect(sql).toContain("has_cart is true")});
});

describe("publishing integration",()=>{
  const source=readFileSync("src/features/commerce/services.ts","utf8");
  it("requires Phase 6C compliance before building an intent",()=>{expect(source).toContain("commerce_compliance_required");expect(source).toContain('compliance.overall_status!=="PASS"');expect(source).toContain('compliance.product_truth_status!=="PASS"')});
  it("re-checks current commerce facts before publishing",()=>{expect(source).toContain("shoppable_intent_stale_or_blocked");expect(source).toContain("evaluateAccountProductCommerce")});
});
