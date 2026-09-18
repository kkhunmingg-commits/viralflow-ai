import type { EffectiveMode } from "@/features/accounts/types";
import type { CreativeConcept } from "./schemas";

export const PROMPT_VERSION="creative-brain-v1";
export const CREATIVE_SCORE_VERSION="creative-concept-v1";
export type RiskStatus="SAFE"|"REVIEW"|"REJECT";
export interface CreativeContext {
  assignment:{id:string;score:number;reason:string};
  account:{id:string;name:string;mode:EffectiveMode;followers:number;preferredCategories:string[]};
  product:{id:string;title:string;category:string;price:number;originalPrice:number|null;commissionRate:number;commissionAmount:number;rating:number|null;reviewCount:number;momentum:number;creativePotential:number};
  category:{momentum:number;commercialOpportunity:number;state:string;saturation:number};
  affinity:{score:number;confidence:number};
  signals:{accountProductFit:number;finalViralOpportunity:number;productConfidence:number;categoryConfidence:number};
  historicalCreativeSignals:{recentAngleTypes:string[];recentHooks:string[]};
  growthLearning:{preferredCategory:string|null;recommendedHook:string|null;recommendedAngle:string|null;cta:string|null;experimentAxis:string|null;confidence:number;sourceEvidence:Record<string,unknown>}|null;
}
export interface ProviderUsage {inputTokens:number;outputTokens:number}
export interface ProviderResult {raw:unknown;output:unknown;usage:ProviderUsage}
export interface AIProvider {
  readonly provider:string; readonly model:string;
  generate(prompt:string,repair:boolean):Promise<ProviderResult>;
}
export interface ScoredConcept {concept:CreativeConcept;score:number;confidence:number;riskStatus:RiskStatus;riskReasons:string[];explanation:Record<string,number|string>}
export interface CreativeProjectRow {
  id:string;owner_id:string;tiktok_account_id:string;product_id:string;product_assignment_id:string;
  mode:EffectiveMode;status:string;selected_angle_id:string|null;selected_script_id:string|null;created_at:string;updated_at:string;
}
