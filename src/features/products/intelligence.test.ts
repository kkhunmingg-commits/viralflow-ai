import {describe,expect,it} from "vitest";
import {DEFAULT_OPPORTUNITY_WEIGHTS,learnOpportunityWeights,rankProducts,unknown,type ProductIntelInput} from "./intelligence";

const at="2026-10-28T00:00:00.000Z",now=new Date(at);
const obs=(value:number)=>({value,source:"fixture",observedAt:at,reliability:"OWNER_REPORT" as const});
// Synthetic fixtures for the scoring contract only; not market data.
const product=(over:Partial<ProductIntelInput>&Pick<ProductIntelInput,"id"|"title"|"categoryKey">):ProductIntelInput=>({model:null,adapter:"OWNER_CATALOG_FILE",sourceUrl:null,capturedAt:at,
  identityVerified:true,stock:"IN_STOCK",price:unknown(),demand:{unitsSold30d:unknown(),velocityPerDay:unknown(),trend:null},commission:{rate:unknown(),amountThb:unknown()},
  marginThb:unknown(),reviews:{rating:unknown(),count:unknown(),complaintRate:unknown()},contentSaturation:unknown(),media:{rightsClearedImages:1,rightsClearedVideos:0,operationFootage:0},
  verifiedFactCount:2,risk:{restrictedCategory:false,counterfeitRisk:false,claimSensitivity:"LOW"},audienceFit:{},costPerUsableClipThb:unknown(),...over});

describe("product intelligence",()=>{
  it("reports a lone product as an existing-product trial with UNKNOWN opportunity, never zero",()=>{
    const report=rankProducts([product({id:"p1",title:"Casio F-91W",categoryKey:"watch"})],{now});
    expect(report.mode).toBe("SINGLE_PRODUCT_TRIAL");
    expect(report.headline).toContain("ไม่ใช่การที่ AI เลือกสินค้าดีที่สุดในตลาด");
    const item=report.items[0];
    expect(item.opportunity.score).toBeNull();expect(item.opportunity.status).toBe("UNKNOWN");
    expect(item.opportunity.components.every(c=>c.value===null&&c.status==="UNKNOWN")).toBe(true);
    expect(item.dataConfidence.label).toBe("NONE");expect(item.creativePotential.score).toBeGreaterThan(0);
  });
  it("ranks several categories from observed data and keeps the four scores separate",()=>{
    const report=rankProducts([
      product({id:"a",title:"Serum",categoryKey:"beauty",price:obs(390),audiencePriceReferenceThb:400,demand:{unitsSold30d:obs(3000),velocityPerDay:obs(90),trend:"RISING"},commission:{rate:obs(.12),amountThb:obs(47)},reviews:{rating:obs(4.6),count:obs(800),complaintRate:obs(.02)},contentSaturation:obs(.7)}),
      product({id:"b",title:"Organizer",categoryKey:"home",price:obs(159),audiencePriceReferenceThb:250,demand:{unitsSold30d:obs(300),velocityPerDay:obs(8),trend:"FALLING"},commission:{rate:obs(.05),amountThb:obs(8)},contentSaturation:obs(.2)}),
      product({id:"c",title:"Snack",categoryKey:"food",stock:"OUT_OF_STOCK",demand:{unitsSold30d:obs(9000),velocityPerDay:obs(300),trend:"RISING"}}),
      product({id:"d",title:"Earbuds",categoryKey:"gadget",media:{rightsClearedImages:0,rightsClearedVideos:0,operationFootage:0}}),
    ],{now});
    expect(report.mode).toBe("RANKED_SET");
    expect(report.items[0].productId).toBe("a");expect(report.items[0].rank).toBe(1);expect(report.items[0].explanation).toContain("อันดับ 1");
    expect(report.items.find(i=>i.productId==="c")!.rank).toBeNull();
    expect(report.items.find(i=>i.productId==="c")!.eligibility.blockers).toContain("สินค้าหมดหรือเลิกผลิต");
    expect(report.items.find(i=>i.productId==="d")!.eligibility.blockers).toContain("ยังไม่มีภาพหรือวิดีโอสินค้าที่ผ่านสิทธิ์");
    const a=report.items[0];
    expect(a.opportunity.components.find(c=>c.key==="audienceFit")!.status).toBe("UNKNOWN");
    expect(a.opportunity.score).not.toBeNull();expect(a.dataConfidence.value).toBeGreaterThan(0);
  });
  it("changes weights only with enough measured outcomes",()=>{
    expect(learnOpportunityWeights(DEFAULT_OPPORTUNITY_WEIGHTS,[{key:"demand",correlation:.9,samples:5}]).applied).toEqual([]);
    const learned=learnOpportunityWeights(DEFAULT_OPPORTUNITY_WEIGHTS,[{key:"demand",correlation:.9,samples:120}]);
    expect(learned.applied).toEqual(["demand"]);expect(learned.weights.demand).toBeGreaterThan(DEFAULT_OPPORTUNITY_WEIGHTS.demand);
    expect(Object.values(learned.weights).reduce((a,b)=>a+b,0)).toBeCloseTo(1,3);
  });
});
