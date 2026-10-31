import { describe,it,expect } from "vitest";
import { calculateProductScore,calculateSalesVelocity,calculateSalesAcceleration,calculateDataConfidence,SCORE_VERSION } from "./scoring";
import { FIXTURE_TIME,fixtureSnapshots,MockProductProvider,TikTokShopProductProvider,normalizedProductSchema,fixtureObservations } from "./providers";
const now = new Date(FIXTURE_TIME);
const score = (id:string) => calculateProductScore(fixtureSnapshots(id),now);
describe("opportunity ranking A–I",()=>{
  it("accelerating B beats slowing giant A, tiny spike C, stable D, falling E, no-sales F and poor economics G",()=>{
    for(const id of ["A","C","D","E","F","G"]) expect(score("B").viral_opportunity_base_score).toBeGreaterThan(score(id).viral_opportunity_base_score);
  });
  it("established 4.8 rating is more reliable than 5.0 with two reviews",()=>{
    expect(score("I").rating_score).toBeGreaterThan(score("H").rating_score);
    expect(score("I").review_confidence).toBeGreaterThan(score("H").review_confidence);
  });
  it.each("ABCDEFGHI".split(""))("fixture %s is deterministic, bounded and explained",(id)=>{
    const result=score(id);
    expect(result).toEqual(score(id));
    expect(result.product_momentum_score).toBeGreaterThanOrEqual(0);
    expect(result.viral_opportunity_base_score).toBeLessThanOrEqual(100);
    expect(result.data_confidence).toBeGreaterThanOrEqual(0);
    expect(result.data_confidence).toBeLessThanOrEqual(1);
    expect(result.score_version).toBe(SCORE_VERSION);
    for(const signal of Object.values(result.explanation_json.signals)) {
      expect(Number.isFinite(signal.score)).toBe(true);
      expect(signal.reason.length).toBeGreaterThan(15);
    }
  });
});
describe("time windows and confidence",()=>{
  it("measures absolute sales/hour and accelerating trend",()=>{
    const rows=fixtureSnapshots("B");
    expect(calculateSalesVelocity(rows,1,now)).toBe(200);
    expect(calculateSalesVelocity(rows,6,now)).toBeCloseTo(430/6);
    expect(calculateSalesVelocity(rows,24,now)).toBeCloseTo(550/24);
    expect(calculateSalesAcceleration(rows,now)).toBeGreaterThan(0);
    expect(score("B").explanation_json.trend).toBe("ACCELERATING");
    expect(score("A").explanation_json.trend).toBe("FALLING");
    expect(score("D").explanation_json.trend).toBe("STABLE");
  });
  it("does not score historical totals",()=>{
    const rows=fixtureSnapshots("B");
    const giant=rows.map(r=>({...r,units_sold:r.units_sold+1000000}));
    expect(calculateProductScore(giant,now)).toEqual(calculateProductScore(rows,now));
  });
  it("caps single snapshot history and penalizes tiny deltas",()=>{
    const rows=fixtureSnapshots("B").slice(-1);
    expect(calculateDataConfidence(rows,now)).toBe(0);
    expect(calculateProductScore(rows,now).explanation_json.trend).toBe("LOW_DATA");
    expect(calculateProductScore(rows,now).viral_opportunity_base_score).toBeLessThan(15);
    expect(score("C").data_confidence).toBeLessThan(score("B").data_confidence);
  });
  it("handles out-of-order, duplicate timestamps, counter resets and missing windows",()=>{
    const rows=fixtureSnapshots("B");
    expect(calculateProductScore([...rows].reverse(),now)).toEqual(score("B"));
    expect(calculateProductScore([...rows,rows[0]],now)).toEqual(score("B"));
    expect(calculateSalesVelocity(rows.slice(-1),1,now)).toBeNull();
    const reset=rows.map((r,i)=>i===rows.length-1?{...r,units_sold:0}:r);
    expect(calculateSalesVelocity(reset,1,now)).toBeNull();
    expect(calculateProductScore(reset,now).explanation_json.counterReset).toBe(true);
  });
  it("ages stale data and excludes future snapshots",()=>{
    expect(calculateDataConfidence(fixtureSnapshots("B"),new Date(now.getTime()+48*3600000))).toBeLessThan(.02);
    expect(()=>calculateProductScore(fixtureSnapshots("B"),new Date("2000-01-01"))).toThrow();
  });
  it("handles zero sales, zero commission and unavailable products",()=>{
    const zero=fixtureSnapshots("F").map(r=>({...r,units_sold:0,commission_rate:0,commission_amount:0}));
    expect(calculateProductScore(zero,now).viral_opportunity_base_score).toBe(0);
    expect(calculateProductScore(fixtureSnapshots("B").map(r=>({...r,status:"unavailable" as const})),now).viral_opportunity_base_score).toBe(0);
  });
});
describe("providers",()=>{
  it("validates normalization and rejects unsafe URLs",()=>{
    const product=fixtureObservations()[0].product;
    expect(()=>normalizedProductSchema.parse({...product,product_url:"javascript:alert(1)"})).toThrow();
    expect(()=>normalizedProductSchema.parse({...product,commission_rate:18})).toThrow();
  });
  it("mock output is deterministic; production adapter is explicitly disabled",async()=>{
    expect(await new MockProductProvider().getProducts()).toEqual(await new MockProductProvider().getProducts());
    await expect(new TikTokShopProductProvider().getProducts()).rejects.toThrow("disabled");
  });
});
