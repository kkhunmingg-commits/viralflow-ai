export type GrowthState="NEW"|"LEARNING"|"GROWING"|"ACCELERATING"|"PLATEAU"|"COMMERCE_RECHECK"|"COMMERCE_READY"|"COMMERCE_BLOCKED";
export type GrowthPatternState="WINNING"|"PROMISING"|"NEUTRAL"|"WEAK"|"INSUFFICIENT_DATA";
export type CategoryAction="EXPAND"|"MAINTAIN"|"TEST"|"REDUCE";
export type NextGrowthAction="TEST_NEW_CATEGORY"|"SCALE_HOOK"|"SCALE_ANGLE"|"CREATE_VARIATION"|"REDUCE_CATEGORY"|"WAIT_FOR_DATA"|"RECHECK_COMMERCE"|"TRANSITION_ELIGIBLE";
export interface GrowthInput {views:number|null;engagement:number|null;comments:number|null;shares:number|null;followerDelta:number|null;followerAttributionConfidence:number;viewVelocityRatio:number|null;accountRelativeImprovement:number|null;categoryImprovement:number|null;ageHours:number;sourceConfidence:number;sampleSize:number;}
export interface FollowerEfficiency {followersPer1000Views:number|null;followersPerVideo:number|null;growthRate:number|null;rollingGrowthRate:number|null;attributionConfidence:number;}
export interface GrowthScore {score:number|null;confidence:number;decision:"OPTIMIZE"|"OBSERVE"|"INSUFFICIENT_DATA";components:Record<string,number|null>;freshness:number;}
export interface PatternSignal {accountId:string;dimension:string;value:string;effect:number;confidence:number;decay:number;sampleSize:number;scope:"ACCOUNT"|"CATEGORY"|"GLOBAL";}
export interface LearnedPattern {dimension:string;value:string;score:number;confidence:number;state:GrowthPatternState;}
export interface CategoryRecommendation {categoryKey:string;score:number;confidence:number;action:CategoryAction;exploration:boolean;}
export interface GrowthRecommendation {nextAction:NextGrowthAction;categoryKey:string|null;hook:string|null;angle:string|null;opening:string;cta:string;sceneStructure:string[];experimentAxis:string|null;confidence:number;originalityRequired:true;commerceClaimsAllowed:false;evidence:Record<string,unknown>;}
export interface CommerceFacts {followerCount:number;authorizationStatus:string|null;affiliateEligible:boolean|null;ecommercePermission:boolean|null;cartPermission:boolean|null;attachmentAvailable:boolean|null;authoritative:boolean;}
export interface GrowthExperimentPlan {hypothesis:string;control:Record<string,string>;variant:Record<string,string>;changedAxis:string;originalityRequired:true;idempotencyKey:string;}
