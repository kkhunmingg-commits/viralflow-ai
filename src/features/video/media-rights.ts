import type {StrategyAsset, StrategyFact} from "../creative/strategist";

/** Mirrors public.media_rights_violations(); the SQL function remains the publish-time authority. */
export type MediaRightsViolation="NO_RIGHTS_RECORD"|"REVOKED"|"NOT_APPROVED"|"EXPIRED"|"COMMERCIAL_NOT_ALLOWED"|"EDIT_NOT_ALLOWED"|"PLATFORM_OUT_OF_SCOPE"|"ACCOUNT_OUT_OF_SCOPE";
export interface MediaRightsRecord {
  id:string; media_asset_id:string; product_id:string|null; origin_source:string; asset_role:string;
  allows_commercial:boolean; allows_edit:boolean; platform_scope:string[]; account_scope:string[]|null;
  review_state:"PENDING"|"APPROVED"|"REJECTED"; expires_at:string|null; revoked_at:string|null;
}
export interface MediaUse {at:Date;accountId:string;platform?:"TIKTOK"}

export function mediaRightsViolations(record:MediaRightsRecord|null|undefined,use:MediaUse):MediaRightsViolation[]{
  if(!record)return ["NO_RIGHTS_RECORD"];
  const at=use.at.getTime(),reasons:MediaRightsViolation[]=[];
  if(record.revoked_at&&Date.parse(record.revoked_at)<=at)reasons.push("REVOKED");
  if(record.review_state!=="APPROVED")reasons.push("NOT_APPROVED");
  // An unparseable expiry is treated as expired rather than open-ended.
  if(record.expires_at&&!(Date.parse(record.expires_at)>at))reasons.push("EXPIRED");
  if(!record.allows_commercial)reasons.push("COMMERCIAL_NOT_ALLOWED");
  if(!record.allows_edit)reasons.push("EDIT_NOT_ALLOWED");
  if(!record.platform_scope.includes(use.platform??"TIKTOK"))reasons.push("PLATFORM_OUT_OF_SCOPE");
  if(record.account_scope&&!record.account_scope.includes(use.accountId))reasons.push("ACCOUNT_OUT_OF_SCOPE");
  return reasons.sort();
}

const STRATEGY_KINDS:Record<string,StrategyAsset["kind"]>={REAL_IMAGE:"REAL_IMAGE",REAL_FOOTAGE:"REAL_FOOTAGE",COMPARISON_FOOTAGE:"COMPARISON_FOOTAGE"};
/** Rights come only from the reviewed ledger; an asset without a valid record stays unconfirmed. */
export function strategyAssetFromLedger(asset:{id:string;product_id:string|null;asset_type:string;source_type:string;storage_path:string;duration_seconds:number|null},
  record:MediaRightsRecord|undefined,use:MediaUse):StrategyAsset|null{
  const kind=record?STRATEGY_KINDS[record.asset_role]:asset.asset_type==="VIDEO"?"REAL_FOOTAGE":"REAL_IMAGE";
  if(record&&!kind)return null; // Roles such as music or original graphics are not product evidence for the strategist.
  // The record must also attest that the media shows this exact product.
  const allowed=mediaRightsViolations(record,use).length===0&&record?.product_id===asset.product_id;
  return {id:asset.id,kind,source:asset.source_type==="UPLOAD"?"OWNER":"AUTHORIZED_CATALOG",reference:asset.storage_path,
    productId:asset.product_id??undefined,durationSeconds:asset.duration_seconds??undefined,rightsConfirmed:allowed,reviewed:allowed};
}

export interface ContentEvidenceRow {id:string;product_id:string|null;topic:string|null;statement:string;source:StrategyFact["source"];
  source_reference:string;role:StrategyFact["role"]|null;captured_at:string;revoked_at:string|null}
export function strategyFactFromEvidence(row:ContentEvidenceRow,at:Date):StrategyFact{
  return {id:row.id,text:row.statement,source:row.source,reference:row.source_reference,capturedAt:row.captured_at,
    verified:!row.revoked_at||Date.parse(row.revoked_at)>at.getTime(),productId:row.product_id??undefined,topic:row.topic??undefined,role:row.role??undefined};
}
