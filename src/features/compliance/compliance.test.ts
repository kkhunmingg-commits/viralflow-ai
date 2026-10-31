import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {determineAIGCDisclosure,runContentComplianceCheck} from "./compliance";
import {originalityFixtures as f} from "./fixtures";
import {calculateOriginality,checkCrossAccountDuplication} from "./originality";
import {calculateAccountPublishHealth,calculateEffectivePublishCap,evaluatePublishEligibility,queueOverflowContent} from "./publishing";

const compliant={text:"ลองดูเนื้อสัมผัสและอ่านรายละเอียดสินค้า",approvedProductFacts:["เนื้อสัมผัสบางเบา"],mode:"GROWTH" as const,cartAvailable:false,affiliateAvailable:false,inheritedRisk:"SAFE" as const,aiGenerated:true,aiModified:true,provider:"local-ffmpeg"};
const healthInput={effectiveMode:"AFFILIATE" as const,authorizationStatus:"authorized",sourceAccountStatus:"active",dailyTarget:20,dailyHardLimit:15,observedPlatformCap:12,internalSafetyLimit:10,postsToday:3,failedPostsToday:0,shopPermission:true,cartEnabled:true};

describe("Phase 6C compliance, product truth, and disclosure",()=>{
  it("passes a valid claim and records honest AIGC disclosure",()=>{const result=runContentComplianceCheck(compliant);expect(result.overallStatus).toBe("PASS");expect(result.aigcStatus).toBe("DISCLOSE");expect(result.aigc.disclosure_recommended).toBe(true)});
  it("rejects a fake discount",()=>expect(runContentComplianceCheck({...compliant,text:"ลดทันที 70% วันนี้เท่านั้น"}).overallStatus).toBe("REJECT"));
  it("allows a discount that exists in approved product facts",()=>expect(runContentComplianceCheck({...compliant,text:"ส่วนลด 20%",approvedProductFacts:["ส่วนลด 20%"]}).overallStatus).toBe("PASS"));
  it("rejects an unsupported medical claim",()=>expect(runContentComplianceCheck({...compliant,text:"รักษาโรคหายขาด"}).overallStatus).toBe("REJECT"));
  it("rejects a fabricated review",()=>expect(runContentComplianceCheck({...compliant,text:"รีวิวจริงจากลูกค้า ทุกคนชอบ"}).overallStatus).toBe("REJECT"));
  it("reviews fake scarcity",()=>expect(runContentComplianceCheck({...compliant,text:"เหลือ 2 ชิ้น วันนี้วันสุดท้าย"}).overallStatus).toBe("REVIEW"));
  it("blocks Affiliate CTA on a Growth-only account",()=>expect(["REVIEW","REJECT"]).toContain(runContentComplianceCheck({...compliant,text:"กดตะกร้าสั่งซื้อเลย"}).overallStatus));
  it.each(["กดติดตามเพื่อดูตอนต่อไป","บันทึกไว้ดูภายหลัง","คอมเมนต์คำถามได้เลย","แชร์ความคิดเห็นของคุณ"])('allows Growth engagement CTA: %s',text=>expect(runContentComplianceCheck({...compliant,text}).overallStatus).toBe("PASS"));
  it("passes an Affiliate CTA when permission and cart are available",()=>expect(runContentComplianceCheck({...compliant,mode:"AFFILIATE",cartAvailable:true,affiliateAvailable:true,text:"กดตะกร้าสั่งซื้อเลย"}).overallStatus).toBe("PASS"));
  it("rejects a fake shop claim",()=>expect(runContentComplianceCheck({...compliant,text:"ซื้อผ่าน TikTok Shop ร้านทางการ"}).overallStatus).toBe("REJECT"));
  it("never suppresses provider/platform disclosure",()=>expect(determineAIGCDisclosure({...compliant,providerRequiresDisclosure:true}).disclosure_required_if_provider_or_platform_indicates).toBe(true));
});

describe("metadata-first originality fixtures A-E",()=>{
  it("A: identical content is rejected",()=>expect(calculateOriginality(f.A,[f.history]).status).toBe("REJECT"));
  it("B: same master with only a different hook is too similar",()=>expect(calculateOriginality(f.B,[f.history]).status).toBe("TOO_SIMILAR"));
  it("C: same product with a different hook, scene, and CTA is an acceptable variation",()=>expect(calculateOriginality(f.C,[f.history]).status).toBe("ACCEPTABLE_VARIATION"));
  it("D: near-identical content across accounts is blocked for review",()=>{const result=calculateOriginality(f.D,[f.history]);expect(["TOO_SIMILAR","REJECT"]).toContain(result.status);expect(result.crossAccountSimilarity).toBeGreaterThanOrEqual(.82)});
  it("E: a distinct angle and scene plan stays original",()=>expect(calculateOriginality(f.E,[f.history]).status).toBe("ORIGINAL"));
  it("cross-account helper excludes the same account",()=>expect(checkCrossAccountDuplication(f.B,[f.history,f.D])).toHaveLength(1));
});

describe("account health, dynamic cap, eligibility, and overflow",()=>{
  const ready=calculateAccountPublishHealth(healthInput);
  it("uses the smallest cap and keeps generation separate",()=>{expect(calculateEffectivePublishCap(healthInput)).toBe(10);expect(ready.remaining).toBe(7)});
  it("keeps Growth publish health ready without ecommerce/cart permission",()=>expect(calculateAccountPublishHealth({...healthInput,effectiveMode:"GROWTH",shopPermission:false,cartEnabled:false}).healthStatus).toBe("READY"));
  it("limits Affiliate mode when ecommerce/cart permission is missing",()=>expect(calculateAccountPublishHealth({...healthInput,shopPermission:false,cartEnabled:false}).healthStatus).toBe("LIMITED"));
  it("blocks disconnected and repeatedly failing accounts",()=>{expect(calculateAccountPublishHealth({...healthInput,authorizationStatus:"expired"}).healthStatus).toBe("DISCONNECTED");expect(calculateAccountPublishHealth({...healthInput,failedPostsToday:3}).healthStatus).toBe("BLOCKED")});
  it("requires human approval and never silently publishes",()=>{const result=evaluatePublishEligibility({complianceStatus:"PASS",originalityStatus:"ORIGINAL",qualityStatus:"PASS",health:ready,requiresShopPermission:true,shopPermission:true});expect(result.finalStatus).toBe("READY_FOR_REVIEW");expect(result.userApprovalRequired).toBe(true);expect(evaluatePublishEligibility({complianceStatus:"PASS",originalityStatus:"ORIGINAL",qualityStatus:"PASS",health:ready,requiresShopPermission:true,shopPermission:true,userApproved:true}).finalStatus).toBe("READY_TO_PUBLISH")});
  it("regenerates duplicates and rejects prohibited claims",()=>{expect(evaluatePublishEligibility({complianceStatus:"PASS",originalityStatus:"TOO_SIMILAR",qualityStatus:"PASS",health:ready,requiresShopPermission:true,shopPermission:true}).finalStatus).toBe("REGENERATE");expect(evaluatePublishEligibility({complianceStatus:"REJECT",originalityStatus:"ORIGINAL",qualityStatus:"PASS",health:ready,requiresShopPermission:true,shopPermission:true}).finalStatus).toBe("REJECT")});
  it("queues overflow instead of bypassing the account cap",()=>{const capped=calculateAccountPublishHealth({...healthInput,dailyTarget:8,dailyHardLimit:8,observedPlatformCap:8,internalSafetyLimit:8,postsToday:8});const result=evaluatePublishEligibility({complianceStatus:"PASS",originalityStatus:"ORIGINAL",qualityStatus:"PASS",health:capped,requiresShopPermission:true,shopPermission:true});expect(result.finalStatus).toBe("QUEUED_NEXT_DAY");expect(result.creatorLimitPass).toBe(false)});
  it("simulates 10 accounts and 200 candidates with 90 ready and 110 queued",()=>{const candidates=Array.from({length:200},(_,index)=>index),accounts=Array.from({length:10},(_,index)=>calculateAccountPublishHealth({...healthInput,dailyTarget:20,dailyHardLimit:15,observedPlatformCap:index%2?8:10,postsToday:0})),capacity=accounts.reduce((sum,account)=>sum+account.effectivePublishCap,0),queued=queueOverflowContent(candidates,capacity);expect(candidates).toHaveLength(200);expect(capacity).toBe(90);expect(queued.filter(item=>item.queueStatus==="READY_FOR_REVIEW")).toHaveLength(90);expect(queued.filter(item=>item.queueStatus==="QUEUE_NEXT_DAY")).toHaveLength(110);expect(calculateOriginality(f.A,[f.history]).status).toBe("REJECT")});
});

describe("Phase 6C migration protections",()=>{
  const sql=readFileSync("supabase/migrations/20260917090000_phase_6c_compliance_originality.sql","utf8");
  it("creates four owner-scoped RLS tables",()=>{for(const table of ["content_compliance_checks","originality_checks","account_publish_health","publish_eligibility_checks"]){expect(sql).toContain(`create table public.${table}`);expect(sql).toContain(`alter table public.${table} enable row level security`)}});
  it("keeps evidence append-only and approval mandatory",()=>{expect(sql).not.toContain("grant select,insert,update on public.content_compliance_checks");expect(sql).not.toContain("grant select,insert,update on public.originality_checks");expect(sql).toContain("user_approval_required boolean not null default true check(user_approval_required)");expect(sql).toContain("final_status <> 'READY_TO_PUBLISH' or user_approved")});
});
