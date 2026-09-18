export const AUTO_STATES=["IDLE","STARTING","RUNNING","PAUSED","WAITING_FOR_DATA","WAITING_FOR_APPROVAL","WAITING_FOR_SLOT","WAITING_FOR_PROVIDER","RETRY_PENDING","BLOCKED","COMPLETED","FAILED","STOPPED"] as const;
export type AutoState=(typeof AUTO_STATES)[number];
export type AutoMode="GROWTH"|"AFFILIATE"|"AUTO";
export type EffectiveAutoMode=Exclude<AutoMode,"AUTO">;
export type FailureType="TRANSIENT"|"PERMISSION"|"BUDGET"|"PROVIDER"|"COMPLIANCE"|"ACCOUNT"|"PUBLISH"|"ANALYTICS"|"UNKNOWN";
export type SafetyGate="QUALITY"|"COMPLIANCE"|"PRODUCT_TRUTH"|"AIGC"|"ORIGINALITY"|"CROSS_ACCOUNT_DUPLICATION"|"ACCOUNT_HEALTH"|"COMMERCE"|"PUBLISH_CAP"|"CONSENT";
export interface AutoRun {id:string;owner_id:string;state:AutoState;run_date:string;current_step:string;attempt:number;budget_usd:number;spent_usd:number;metrics_json:Record<string,unknown>;blockers_json:string[];idempotency_key:string;started_at:string|null;updated_at:string;completed_at:string|null;paused_at:string|null;}
export interface AutoAccountState {id:string;auto_run_id:string;tiktok_account_id:string;requested_mode:AutoMode;effective_mode:EffectiveAutoMode;state:Exclude<AutoState,"IDLE">;current_step:string;next_action:string|null;blockers_json:string[];desired_daily_candidates:number;desired_daily_posts:number;max_daily_cost_usd:number;generated_today:number;queued_today:number;published_today:number;generation_capacity:number;publish_capacity:number;priority:number;checkpoint_version:number;}
export interface AutoStep {id:string;step:string;state:string;attempt:number;}
export interface AutoFailure {id:string;failure_type:FailureType;retryable:boolean;reason:string;}
export interface AutoAction {id:string;action_type:string;status:string;}
export interface AutoCheckpoint {id:string;checkpoint_version:number;step:string;}
export interface AccountContext {id:string;requestedMode:AutoMode;commerceReady:boolean;providerAvailable:boolean;providerBudgetAvailable?:boolean;analyticsFresh:boolean;accountHealthy:boolean;consent:boolean;publishRemaining:number;desiredCandidates:number;desiredPosts:number;priority:number;nextGrowthAction?:string;affiliateDecision?:"SCALE"|"WATCH"|"STOP"|"INSUFFICIENT_DATA";}
export interface BudgetContext {estimated:number;runBudget:number;runSpent:number;accountBudget:number;accountSpent:number;providerBudget:number;providerSpent:number;perVideoBudget:number;dailyBudget:number;dailySpent:number;monthlyBudget:number;monthlySpent:number;}
export interface GateInput {mode:EffectiveAutoMode;quality:boolean;compliance:boolean;productTruth:boolean;aigc:boolean;originality:boolean;crossAccountUnique:boolean;accountHealth:boolean;commerceReady:boolean;publishCapacity:boolean;consent:boolean;}
export interface PlannedAccount {accountId:string;mode:EffectiveAutoMode;state:Exclude<AutoState,"IDLE">;nextAction:string;blockers:string[];generationCapacity:number;publishCapacity:number;}
