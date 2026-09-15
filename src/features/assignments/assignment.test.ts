import { describe, expect, it } from "vitest";
import { assignmentFixtures } from "./fixtures";
import { buildDailyAssignments, assignmentDate, getRecommendationsForAccount } from "./planner";
import { calculateAccountProductFit, getEligibleProductAccounts } from "./scoring";

describe("account-product-fit-v1",()=>{
  const input=assignmentFixtures();
  const plan=buildDailyAssignments(input);
  const ranked=(id:string)=>plan.scores.filter(s=>s.accountId===id&&s.eligible).toSorted((a,b)=>b.final_viral_opportunity_score-a.final_viral_opportunity_score);
  it("Growth favors Beauty and affiliate economics differ",()=>{
    expect(["P1","P2"]).toContain(ranked("A")[0].productId);
    expect(ranked("B")[0].productId).toBe("P3");
    expect(ranked("C")[0].productId).toBe("P5");
    const b=ranked("B");
    expect(b.find(s=>s.productId==="P3")!.final_viral_opportunity_score).toBeGreaterThan(b.find(s=>s.productId==="P4")!.final_viral_opportunity_score);
    for(const id of ["A","B","C"])expect(ranked(id)[0].productId).not.toBe("P6");
  });
  it("Growth commission is not a direct driver",()=>{
    const p=input.products[0],a=input.accounts[0],c=input.categories[0],f=input.affinities[0];
    expect(calculateAccountProductFit(a,p,c,f,input.now).account_product_fit_score).toBe(calculateAccountProductFit(a,{...p,commission:100},c,f,input.now).account_product_fit_score);
  });
  it("low-data spike is blocked and borderline data is capped",()=>{
    expect(plan.scores.filter(s=>s.productId==="P7").every(s=>!s.eligible&&s.final_viral_opportunity_score===0)).toBe(true);
    const p={...input.products[6],confidence:.3};
    const result=calculateAccountProductFit(input.accounts[0],p,input.categories[0],input.affinities[0],input.now);
    expect(result.final_viral_opportunity_score).toBeLessThanOrEqual(35);
  });
  it("staleness, confidence and saturation lower final score",()=>{
    const a=input.accounts[0],p=input.products[0],c=input.categories[0],f=input.affinities[0];
    const baseline=calculateAccountProductFit(a,p,c,f,input.now).final_viral_opportunity_score;
    for(const [product,category] of [[{...p,confidence:.5},c],[{...p,observedAt:"2026-09-14T12:00:00Z"},c],[p,{...c,saturation:1}]] as const)
      expect(calculateAccountProductFit(a,product,category,f,input.now).final_viral_opportunity_score).toBeLessThan(baseline);
  });
  it("returns structured eligibility blockers without requiring Growth cart",()=>{
    const a=input.accounts[0],p=input.products[0],c=input.categories[0];
    expect(getEligibleProductAccounts(a,p,c,input.now)).toEqual([]);
    for(const account of [{...a,account_status:"inactive"},{...a,authorization_status:"disconnected" as const},{...a,effective_mode:"AFFILIATE" as const}] )
      expect(getEligibleProductAccounts(account,p,c,input.now).length).toBeGreaterThan(0);
    expect(getEligibleProductAccounts(a,{...p,product:{...p.product,status:"unavailable"}},c,input.now)[0].code).toBe("PRODUCT_UNAVAILABLE");
    expect(getEligibleProductAccounts(a,{...p,observedAt:"2020-01-01"},c,input.now).some(b=>b.code==="PRODUCT_STALE")).toBe(true);
    expect(getEligibleProductAccounts(a,p,{...c,confidence:.1},input.now).some(b=>b.code==="CATEGORY_LOW_CONFIDENCE")).toBe(true);
    expect(getEligibleProductAccounts(a,p,undefined,input.now).some(b=>b.code==="CATEGORY_MISSING")).toBe(true);
  });
  it("daily planner obeys category cap, target, hard limit and deterministic ordering",()=>{
    const p=buildDailyAssignments({...input,accounts:input.accounts.map(a=>({...a,daily_post_target:8,daily_post_hard_limit:1}))});
    for(const a of input.accounts)expect(getRecommendationsForAccount(p,a.id)).toHaveLength(1);
    expect(buildDailyAssignments(input)).toEqual(buildDailyAssignments({...input,products:[...input.products].reverse(),accounts:[...input.accounts].reverse()}));
  });
  it("global winner goes to strongest account, with alternatives for others",()=>{
    const shared=assignmentFixtures();
    shared.accounts=shared.accounts.map(a=>({...a,effective_mode:"GROWTH",daily_post_target:1}));
    shared.affinities=[];
    shared.products=shared.products.slice(0,3).map((p,i)=>({...p,momentum:i?70:100,creative:90,commission:90,product:{...p.product,category_key:"beauty"}}));
    shared.affinities=shared.accounts.map((a,i)=>({accountId:a.id,categoryKey:"beauty",score:.95-i*.1,confidence:1}));
    const p=buildDailyAssignments(shared,{allowSharedProductWhenScoreAdvantageIsLarge:false});
    expect(p.assignments.find(a=>a.score.productId==="P1")!.score.accountId).toBe("A");
    expect(new Set(p.assignments.map(a=>a.score.productId)).size).toBe(3);
    const allowed=buildDailyAssignments(shared,{sharingScoreGap:0,maxAccountsPerProduct:2});
    expect(allowed.assignments.filter(a=>a.score.productId==="P1")).toHaveLength(2);
    expect(allowed.assignments.some(a=>a.reason.includes("Sharing allowed"))).toBe(true);
  });
  it("preserves selected/used/skipped pairs and accounts for published posts",()=>{
    const existing={tiktok_account_id:"A",product_id:"P1",category_key:"beauty",assignment_date:plan.date,rank_for_account:1,final_score:80,status:"USED" as const};
    const p=buildDailyAssignments({...input,existing:[existing],publishedToday:{A:2}});
    expect(getRecommendationsForAccount(p,"A")).toHaveLength(0);
    const q=buildDailyAssignments({...input,existing:[{...existing,status:"SKIPPED"}]});
    expect(getRecommendationsForAccount(q,"A").some(a=>a.score.productId==="P1")).toBe(false);
  });
  it("Bangkok date rolls over at 17:00 UTC and future evidence is blocked",()=>{
    expect(assignmentDate("2026-09-15T17:00:00Z")).toBe("2026-09-16");
    expect(getEligibleProductAccounts(input.accounts[0],{...input.products[0],observedAt:"2099-01-01"},input.categories[0],input.now).length).toBeGreaterThan(0);
  });
});
