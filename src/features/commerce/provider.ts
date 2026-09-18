import {buildShoppableIntent,checkShopProductTruth,evaluateAccountProductCommerce} from "./readiness";
import type {CreatorCommerceProfile,ProductPermission,ShopAuthorization,ShopProduct,ShoppableIntent,TikTokShopProvider} from "./types";

export class TikTokShopApprovalRequiredProvider implements TikTokShopProvider {
  readonly name="tiktok-shop";readonly apiAccessStatus="APPROVAL_REQUIRED" as const;
  private unavailable():never{throw new Error("tiktok_shop_api_approval_required")}
  async getAuthorizationStatus():Promise<ShopAuthorization>{return this.unavailable()}
  async getCreatorCommerceProfile():Promise<CreatorCommerceProfile>{return this.unavailable()}
  async listEligibleProducts():Promise<ShopProduct[]>{return this.unavailable()}
  async getProduct():Promise<ShopProduct|null>{return this.unavailable()}
  async checkProductEligibility():Promise<ProductPermission>{return this.unavailable()}
  async checkAttachmentPermission():Promise<ProductPermission>{return this.unavailable()}
  async buildShoppableIntent():Promise<ShoppableIntent>{return this.unavailable()}
}

export class MockTikTokShopProvider implements TikTokShopProvider {
  readonly name="mock";readonly apiAccessStatus="AVAILABLE" as const;
  constructor(private readonly profiles:CreatorCommerceProfile[],private readonly products:ShopProduct[],private readonly permissions:Record<string,ProductPermission>={}){}
  async getAuthorizationStatus(accountId:string){const p=await this.getCreatorCommerceProfile(accountId);return {status:p.authorizationStatus,apiAccess:"AVAILABLE" as const,region:p.region,grantedScopes:p.authorizationStatus==="AUTHORIZED"?["affiliate.creator.info","affiliate.collaboration.read"]:[],missingScopes:p.authorizationStatus==="AUTHORIZED"?[]:["affiliate.creator.info"],lastSyncedAt:"2026-09-18T00:00:00.000Z"}}
  async getCreatorCommerceProfile(accountId:string){const profile=this.profiles.find(p=>p.accountId===accountId);if(!profile)throw new Error("mock_creator_profile_not_found");return profile}
  async listEligibleProducts(accountId:string){const profile=await this.getCreatorCommerceProfile(accountId);return this.products.filter(p=>p.region===profile.region&&p.productStatus==="ACTIVE"&&p.auditStatus==="APPROVED")}
  async getProduct(productId:string){return this.products.find(p=>p.id===productId)??null}
  async checkProductEligibility(accountId:string,productId:string){return this.permission(accountId,productId)}
  async checkAttachmentPermission(accountId:string,productId:string){return this.permission(accountId,productId)}
  async buildShoppableIntent(input:{accountId:string;productId:string;contentFit:boolean;truth:Parameters<typeof checkShopProductTruth>[0]}){const profile=await this.getCreatorCommerceProfile(input.accountId),product=await this.getProduct(input.productId);if(!product)throw new Error("mock_shop_product_not_found");const permission=this.permission(input.accountId,input.productId),eligibility=evaluateAccountProductCommerce({requestedMode:"AUTO",profile,product,permission,contentFit:input.contentFit});return buildShoppableIntent({eligibility,truth:checkShopProductTruth(input.truth),product})}
  private permission(accountId:string,productId:string):ProductPermission{return this.permissions[`${accountId}:${productId}`]??{status:"NOT_ALLOWED",canAddToShowcase:false,canAttachToVideo:false,blockers:["PRODUCT_ATTACHMENT_NOT_ALLOWED"]}}
}
