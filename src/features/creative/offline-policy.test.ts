import {describe,it,expect} from "vitest";
import {isOfflineProductAssignment,canExecuteOfflineProduct,OFFLINE_PRODUCT_VERSION} from "./offline-policy";
describe("offline product selection",()=>{
  const row={owner_id:"owner",score_version:OFFLINE_PRODUCT_VERSION,effective_mode:"GROWTH",final_score:0,status:"SELECTED",reason_json:{purpose:"OWNER_OFFLINE_PRODUCT",requestedBy:"owner"}};
  it("keeps a zero-scored owner selection distinct from market eligibility",()=>{
    expect(isOfflineProductAssignment(row,"owner")).toBe(true);
    for(const change of [{owner_id:"other"},{score_version:"market-v1"},{final_score:1},{effective_mode:"AFFILIATE"},{status:"BLOCKED"},{reason_json:{purpose:"OWNER_OFFLINE_PRODUCT",requestedBy:"other"}}])
      expect(isOfflineProductAssignment({...row,...change},"owner")).toBe(false);
  });
  it("requires the real owner session and rejects scheduler, mock and affiliate execution",()=>{
    const input={owner:"owner",sessionOwner:"owner",role:"developer",realAccount:true,mode:"GROWTH"};
    expect(canExecuteOfflineProduct(input)).toBe(true);
    for(const change of [{sessionOwner:undefined},{sessionOwner:"other"},{role:"member"},{realAccount:false},{mode:"AFFILIATE"},{forAutoWorker:true}])
      expect(canExecuteOfflineProduct({...input,...change})).toBe(false);
  });
});
