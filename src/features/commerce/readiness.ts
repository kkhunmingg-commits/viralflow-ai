import type {CommerceEligibility,CommerceStatus,CreatorCommerceProfile,ProductPermission,ProductTruthInput,ShopProduct,ShoppableIntent} from "./types";

export function calculateCommerceStatus(profile:CreatorCommerceProfile):{status:CommerceStatus;blockers:string[]} {
  const blockers:string[]=[];
  if(profile.authorizationStatus==="REVOKED"||profile.authorizationStatus==="REAUTH_REQUIRED"){blockers.push("SHOP_REAUTH_REQUIRED");return {status:"REAUTH_REQUIRED",blockers}}
  if(profile.followerCount<1000)blockers.push("FOLLOWERS_BELOW_1000");
  if(profile.authorizationStatus!=="AUTHORIZED")blockers.push("SHOP_AUTHORIZATION_MISSING");
  if(!profile.affiliateEligible)blockers.push("AFFILIATE_NOT_ELIGIBLE");
  if(!profile.ecommercePermission)blockers.push("ECOMMERCE_PERMISSION_MISSING");
  if(!profile.cartPermission)blockers.push("CART_PERMISSION_MISSING");
  if(!profile.attachmentAvailable)blockers.push("ATTACHMENT_PERMISSION_MISSING");
  if(!blockers.length)return {status:"AFFILIATE_READY",blockers};
  if(profile.followerCount<1000)return {status:"GROWTH",blockers};
  if(!profile.ecommercePermission||profile.authorizationStatus!=="AUTHORIZED")return {status:"FOLLOWER_READY_NO_COMMERCE",blockers};
  return {status:"COMMERCE_BLOCKED",blockers};
}

export function resolveEffectiveCommerceMode(requested:"AUTO"|"GROWTH"|"AFFILIATE",profile:CreatorCommerceProfile){
  const readiness=calculateCommerceStatus(profile);
  return requested!=="GROWTH"&&readiness.status==="AFFILIATE_READY"?"AFFILIATE" as const:"GROWTH" as const;
}

export function checkShopProductTruth(input:ProductTruthInput):{status:"PASS"|"REVIEW"|"REJECT";blockers:string[]} {
  const blockers:string[]=[];
  const normalized=(value:string)=>value.toLowerCase().replace(/\s+/g," ").trim();
  if(normalized(input.radarTitle)!==normalized(input.shopProduct.title))blockers.push("PRODUCT_TITLE_MISMATCH");
  if(Math.abs(input.radarPrice-input.shopProduct.currentPrice)>.01)blockers.push("PRODUCT_PRICE_MISMATCH");
  if((input.radarOriginalPrice??null)!==(input.shopProduct.originalPrice??null))blockers.push("PRODUCT_DISCOUNT_MISMATCH");
  if(input.radarStatus!=="available"||input.shopProduct.productStatus!=="ACTIVE"||input.shopProduct.auditStatus!=="APPROVED")blockers.push("PRODUCT_NOT_ACTIVE_OR_APPROVED");
  if(input.shopProduct.sellerStatus!=="ACTIVE")blockers.push("SELLER_NOT_ACTIVE");
  if((input.claimedFeatures??[]).some(feature=>!(input.shopProduct.features??[]).map(normalized).includes(normalized(feature))))blockers.push("UNSUPPORTED_PRODUCT_FEATURE");
  return {status:blockers.length?"REJECT":"PASS",blockers};
}

export function evaluateAccountProductCommerce(input:{requestedMode:"AUTO"|"GROWTH"|"AFFILIATE";profile:CreatorCommerceProfile;product:ShopProduct;permission:ProductPermission;contentFit:boolean}):CommerceEligibility {
  const readiness=calculateCommerceStatus(input.profile),regionMatch=input.profile.region===input.product.region,productEligible=input.product.productStatus==="ACTIVE"&&input.product.auditStatus==="APPROVED"&&["OPEN","TARGETED"].includes(input.product.collaborationStatus),attachmentAllowed=input.permission.status==="ALLOWED"&&input.permission.canAttachToVideo;
  const blockers=[...readiness.blockers,...input.permission.blockers];if(!regionMatch)blockers.push("REGION_MISMATCH");if(!productEligible)blockers.push("PRODUCT_NOT_ELIGIBLE");if(!attachmentAllowed)blockers.push("PRODUCT_ATTACHMENT_NOT_ALLOWED");
  const accountReady=readiness.status==="AFFILIATE_READY",commerceEligible=accountReady&&productEligible&&attachmentAllowed&&regionMatch;
  const effective=resolveEffectiveCommerceMode(input.requestedMode,input.profile),status:CommerceEligibility["status"]=readiness.status==="REAUTH_REQUIRED"?"REAUTH_REQUIRED":commerceEligible&&effective==="AFFILIATE"?"ELIGIBLE":effective==="GROWTH"&&input.contentFit?"CONTENT_ONLY":"BLOCKED";
  return {contentFit:input.contentFit,commerceEligible,accountReady,productEligible,attachmentAllowed,regionMatch,status,blockers:[...new Set(blockers)]};
}

export function validateCommerceCta(input:{mode:"GROWTH"|"AFFILIATE";text:string;eligibility?:CommerceEligibility}){const shopCta=/(กดตะกร้า|สั่งซื้อ|ซื้อเลย|เพิ่มสินค้า|shop now|buy now)/i.test(input.text);if(shopCta&&input.mode==="GROWTH")return {allowed:false,reason:"GROWTH_SHOP_CTA_BLOCKED"};if(shopCta&&!input.eligibility?.commerceEligible)return {allowed:false,reason:"COMMERCE_PERMISSION_REQUIRED"};return {allowed:true,reason:null}}

export function buildShoppableIntent(input:{eligibility:CommerceEligibility;truth:ReturnType<typeof checkShopProductTruth>;product:ShopProduct}):ShoppableIntent {
  const blockers=[...input.eligibility.blockers,...input.truth.blockers];const status:ShoppableIntent["status"]=input.truth.status==="REJECT"||!input.eligibility.commerceEligible?"BLOCKED":"READY_FOR_REVIEW";
  return {type:"PRODUCT_ATTACHMENT",status,productTruthStatus:input.truth.status,metadata:{shopProductId:input.product.id,externalProductId:input.product.externalProductId,region:input.product.region,title:input.product.title,price:input.product.currentPrice,currency:input.product.currency,attachmentPerformed:false},blockers:[...new Set(blockers)]};
}
