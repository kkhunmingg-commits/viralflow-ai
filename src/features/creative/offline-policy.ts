export const OFFLINE_PRODUCT_VERSION="owner-offline-product-v1";
/** An explicit offline editorial selection, never an eligible marketplace recommendation. */
export function isOfflineProductAssignment(row:Record<string,unknown>,owner:string){
  const reason=row.reason_json as Record<string,unknown>|null;
  return row.owner_id===owner&&row.score_version===OFFLINE_PRODUCT_VERSION&&row.effective_mode==="GROWTH"&&Number(row.final_score)===0&&["SELECTED","USED"].includes(String(row.status))&&
    reason?.purpose==="OWNER_OFFLINE_PRODUCT"&&reason?.requestedBy===owner;
}
export function canExecuteOfflineProduct(input:{owner:string;sessionOwner?:string;role?:unknown;realAccount:boolean;mode:string;forAutoWorker?:boolean}){
  return input.sessionOwner===input.owner&&["developer","admin"].includes(String(input.role))&&input.realAccount&&input.mode==="GROWTH"&&!input.forAutoWorker;
}
