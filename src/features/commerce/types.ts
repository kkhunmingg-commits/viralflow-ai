export const COMMERCE_VERSION="tiktok-shop-commerce-v1";
export type ShopAuthorizationStatus="NOT_CONNECTED"|"PENDING"|"AUTHORIZED"|"PARTIAL"|"REAUTH_REQUIRED"|"REVOKED"|"ERROR";
export type ApiAccessStatus="AVAILABLE"|"APPROVAL_REQUIRED"|"NOT_AVAILABLE";
export type CommerceStatus="GROWTH"|"FOLLOWER_READY_NO_COMMERCE"|"COMMERCE_BLOCKED"|"AFFILIATE_READY"|"REAUTH_REQUIRED";
export type CommerceEligibilityStatus="CONTENT_ONLY"|"ELIGIBLE"|"BLOCKED"|"REAUTH_REQUIRED";

export interface ShopAuthorization {status:ShopAuthorizationStatus;apiAccess:ApiAccessStatus;region:string;grantedScopes:string[];missingScopes:string[];lastSyncedAt:string|null}
export interface CreatorCommerceProfile {accountId:string;region:string;followerCount:number;affiliateEligible:boolean;ecommercePermission:boolean;cartPermission:boolean;showcaseAvailable:boolean;attachmentAvailable:boolean;authorizationStatus:ShopAuthorizationStatus}
export interface ShopProduct {id:string;externalProductId:string;linkedProductId?:string|null;region:string;title:string;sellerName?:string|null;sellerStatus:"ACTIVE"|"INACTIVE"|"SUSPENDED"|"UNKNOWN";currency:string;currentPrice:number;originalPrice?:number|null;commissionRate?:number|null;productStatus:"ACTIVE"|"INACTIVE"|"UNAVAILABLE"|"UNDER_REVIEW"|"REJECTED";collaborationStatus:"OPEN"|"TARGETED"|"NONE"|"UNKNOWN";auditStatus:"APPROVED"|"PENDING"|"REJECTED"|"UNKNOWN";features?:string[]}
export interface ProductPermission {status:"ALLOWED"|"APPROVAL_REQUIRED"|"NOT_ALLOWED"|"REVOKED"|"UNKNOWN";canAddToShowcase:boolean;canAttachToVideo:boolean;blockers:string[]}
export interface ProductTruthInput {radarTitle:string;radarPrice:number;radarOriginalPrice:number|null;radarStatus:string;shopProduct:ShopProduct;claimedFeatures?:string[]}
export interface CommerceEligibility {contentFit:boolean;commerceEligible:boolean;accountReady:boolean;productEligible:boolean;attachmentAllowed:boolean;regionMatch:boolean;status:CommerceEligibilityStatus;blockers:string[]}
export interface ShoppableIntent {type:"PRODUCT_ATTACHMENT"|"SHOWCASE_LINK";status:"DRAFT"|"BLOCKED"|"READY_FOR_REVIEW"|"APPROVAL_REQUIRED";productTruthStatus:"PASS"|"REVIEW"|"REJECT";metadata:Record<string,unknown>;blockers:string[]}
export interface TikTokShopProvider {
  readonly name:string;
  readonly apiAccessStatus:ApiAccessStatus;
  getAuthorizationStatus(accountId:string):Promise<ShopAuthorization>;
  getCreatorCommerceProfile(accountId:string):Promise<CreatorCommerceProfile>;
  listEligibleProducts(accountId:string):Promise<ShopProduct[]>;
  getProduct(productId:string):Promise<ShopProduct|null>;
  checkProductEligibility(accountId:string,productId:string):Promise<ProductPermission>;
  checkAttachmentPermission(accountId:string,productId:string):Promise<ProductPermission>;
  buildShoppableIntent(input:{accountId:string;productId:string;contentFit:boolean;truth:ProductTruthInput}):Promise<ShoppableIntent>;
}
