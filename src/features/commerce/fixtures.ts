import type {CreatorCommerceProfile,ProductPermission,ShopProduct} from "./types";
const profile=(accountId:string,values:Partial<CreatorCommerceProfile>):CreatorCommerceProfile=>({accountId,region:"TH",followerCount:500,affiliateEligible:false,ecommercePermission:false,cartPermission:false,showcaseAvailable:false,attachmentAvailable:false,authorizationStatus:"NOT_CONNECTED",...values});
export const commerceProfiles={
  A:profile("A",{}),
  B:profile("B",{followerCount:1500}),
  C:profile("C",{followerCount:1500,affiliateEligible:true,ecommercePermission:true,authorizationStatus:"AUTHORIZED"}),
  D:profile("D",{followerCount:1500,affiliateEligible:true,ecommercePermission:true,cartPermission:true,showcaseAvailable:true,attachmentAvailable:true,authorizationStatus:"AUTHORIZED"}),
  I:profile("I",{followerCount:1500,affiliateEligible:true,ecommercePermission:true,cartPermission:true,authorizationStatus:"REVOKED"}),
};
const product=(id:string,values:Partial<ShopProduct>={}):ShopProduct=>({id,externalProductId:`shop-${id}`,region:"TH",title:"ครีมตัวอย่าง",sellerStatus:"ACTIVE",currency:"THB",currentPrice:299,originalPrice:399,commissionRate:.15,productStatus:"ACTIVE",collaborationStatus:"OPEN",auditStatus:"APPROVED",features:["เนื้อบางเบา"],...values});
export const commerceProducts={E:product("E",{productStatus:"UNAVAILABLE"}),F:product("F"),G:product("G",{region:"US"}),H:product("H")};
export const allowedPermission:ProductPermission={status:"ALLOWED",canAddToShowcase:true,canAttachToVideo:true,blockers:[]};
export const blockedPermission:ProductPermission={status:"NOT_ALLOWED",canAddToShowcase:false,canAttachToVideo:false,blockers:["PRODUCT_ATTACHMENT_NOT_ALLOWED"]};
