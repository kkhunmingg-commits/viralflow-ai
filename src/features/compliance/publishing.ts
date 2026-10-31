import type {AccountHealthInput,AccountHealthResult,PublishEligibilityInput,PublishEligibilityResult} from "./types";

export function calculateEffectivePublishCap(input:Pick<AccountHealthInput,"dailyTarget"|"dailyHardLimit"|"observedPlatformCap"|"internalSafetyLimit">){return Math.max(0,Math.min(input.dailyTarget,input.dailyHardLimit,input.observedPlatformCap??20,input.internalSafetyLimit??10))}
export function calculateAccountPublishHealth(input:AccountHealthInput):AccountHealthResult {
  const blockers:string[]=[],cap=calculateEffectivePublishCap(input);
  let status:AccountHealthResult["healthStatus"]="READY";
  if(input.authorizationStatus!=="authorized"){status="DISCONNECTED";blockers.push("AUTHORIZATION_NOT_READY")}
  else if(input.paused){status="PAUSED";blockers.push("ACCOUNT_PAUSED")}
  else if(input.sourceAccountStatus!=="active"){status="BLOCKED";blockers.push("ACCOUNT_NOT_ACTIVE")}
  else if(input.effectiveMode==="AFFILIATE"&&(!input.shopPermission||!input.cartEnabled)){status="LIMITED";blockers.push("SHOP_OR_CART_PERMISSION_MISSING")}
  if(input.postsToday>=cap){if(status==="READY")status="LIMITED";blockers.push("DAILY_CAP_REACHED")}
  if(input.failedPostsToday>=3){status="BLOCKED";blockers.push("REPEATED_PUBLISH_FAILURES")}
  return {accountStatus:status,healthStatus:status,effectivePublishCap:cap,remaining:Math.max(0,cap-input.postsToday),blockers};
}
export function evaluatePublishEligibility(input:PublishEligibilityInput):PublishEligibilityResult {
  const blockers:string[]=[],compliancePass=input.complianceStatus==="PASS",originalityPass=["ORIGINAL","ACCEPTABLE_VARIATION"].includes(input.originalityStatus),qualityPass=input.qualityStatus==="PASS",creatorLimitPass=input.health.remaining>0,shopPermissionPass=!input.requiresShopPermission||input.shopPermission,accountHealthPass=input.health.healthStatus==="READY"||(input.health.healthStatus==="LIMITED"&&!creatorLimitPass&&input.health.blockers.every(blocker=>blocker==="DAILY_CAP_REACHED"));
  if(!compliancePass)blockers.push(`COMPLIANCE_${input.complianceStatus}`);if(!originalityPass)blockers.push(`ORIGINALITY_${input.originalityStatus}`);if(!qualityPass)blockers.push("QUALITY_NOT_PASSED");if(!accountHealthPass)blockers.push(...input.health.blockers);if(!creatorLimitPass)blockers.push("CREATOR_LIMIT_REACHED");if(!shopPermissionPass)blockers.push("SHOP_PERMISSION_MISSING");
  let finalStatus:PublishEligibilityResult["finalStatus"]="READY_FOR_REVIEW";
  if(["BLOCKED","DISCONNECTED"].includes(input.health.healthStatus))finalStatus="ACCOUNT_BLOCKED";
  else if(input.complianceStatus==="REJECT"||input.originalityStatus==="REJECT")finalStatus="REJECT";
  else if(input.originalityStatus==="TOO_SIMILAR"||!qualityPass)finalStatus="REGENERATE";
  else if(!creatorLimitPass&&accountHealthPass)finalStatus="QUEUED_NEXT_DAY";
  else if(blockers.length)finalStatus="HOLD";
  else if(input.userApproved)finalStatus="READY_TO_PUBLISH";
  return {compliancePass,originalityPass,qualityPass,accountHealthPass,creatorLimitPass,shopPermissionPass,userApprovalRequired:true,finalStatus,blockers:[...new Set(blockers)]};
}
export function queueOverflowContent<T>(candidates:T[],capacity:number){return candidates.map((candidate,index)=>({candidate,queueStatus:index<capacity?"READY_FOR_REVIEW" as const:"QUEUE_NEXT_DAY" as const,position:index<capacity?index+1:index-capacity+1}))}
