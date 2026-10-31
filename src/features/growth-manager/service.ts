import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/server-env";
import { accountAutomationSchema } from "../multi-account/contracts";
import { localDay } from "../multi-account/scheduler";
import { analyzeGrowth, growthSlots } from "./planner";
import { pilotPolicySchema, type GrowthDecision, type GrowthEvidence, type GrowthPilotView, type GrowthSlot } from "./contracts";
import { chooseGrowthTopics, type TopicEvidence } from "./topics";
import { accountAutoPermission } from "./discovery-service";
import { prepareAffiliateHandoff } from "./affiliate-handoff";

type Pilot={owner_id:string;tiktok_account_id:string;enabled:boolean;health_confirmed:boolean;policy:unknown;started_at:string|null};
interface Facts { pilot:Pilot;account:{name:string;username:string|null;isMock:boolean;authorization:string;status:string;hidden:boolean;audit:string;directPost:string;tokenReady:boolean;publishGranted:boolean};health:string|null;publishCap:number|null;posts:GrowthEvidence["posts"];followers:GrowthEvidence["followers"];publishedToday:number;lastPublishedAt:string|null; }
const check=(error:unknown)=>{if(error)throw new Error("GROWTH_STORAGE_UNAVAILABLE");};
const unavailable=(e:{code?:string}|null)=>e&&["42P01","PGRST202","PGRST205"].includes(e.code??"");
export async function activeGrowthPilot(admin:SupabaseClient):Promise<Pilot|null>{
  const r=await admin.from("growth_pilot_allowlist").select("owner_id,tiktok_account_id,enabled,health_confirmed,policy,started_at").eq("singleton",true).eq("enabled",true).maybeSingle();
  if(unavailable(r.error))return null;check(r.error);return r.data as Pilot|null;
}
async function context(admin:SupabaseClient,owner:string,now:Date){
  const response=await admin.rpc("growth_pilot_facts",{p_owner:owner});
  if(unavailable(response.error))return null;check(response.error);if(!response.data)return null;
  const facts=response.data as Facts,p=facts.pilot;
  if(p.owner_id!==owner)throw new Error("GROWTH_NOT_AUTHORIZED");
  const setting=await admin.from("account_automation_settings").select("config").eq("owner_id",owner).eq("tiktok_account_id",p.tiktok_account_id).maybeSingle();check(setting.error);
  const config=accountAutomationSchema.parse(setting.data?.config??{}),policy=pilotPolicySchema.parse(p.policy),day=localDay(now,config.timezone);
  // Ignore any old manually configured topics. The system chooses from actual authorized evidence.
  policy.topics=chooseGrowthTopics((response.data.topicEvidence??[]) as TopicEvidence[],now);
  const [prior,current]=await Promise.all([
    admin.from("growth_pilot_plans").select("decision,changed_at").eq("owner_id",owner).eq("tiktok_account_id",p.tiktok_account_id).lt("local_day",day).order("local_day",{ascending:false}).limit(1).maybeSingle(),
    admin.from("growth_pilot_plans").select("slots").eq("owner_id",owner).eq("tiktok_account_id",p.tiktok_account_id).eq("local_day",day).maybeSingle(),
  ]);check(prior.error);check(current.error);
  const a=facts.account;
  const health:GrowthEvidence["accountHealth"]=!a||a.isMock||a.hidden||a.authorization!=="authorized"||a.status!=="active"?"BLOCKED"
    :facts.health==="BLOCKED"||facts.health==="DISCONNECTED"?"BLOCKED"
    :facts.health==="LIMITED"||facts.health==="PAUSED"?"WARNING"
    :facts.health==="READY"||p.health_confirmed?"READY":"UNKNOWN";
  const manualReported=(current.data?.slots as GrowthSlot[]|undefined)?.filter(s=>s.state==="MANUAL_REPORTED").length??0;
  const evidence:GrowthEvidence={posts:facts.posts??[],followers:facts.followers??[],accountHealth:health,publishCap:facts.publishCap??null,
    publicApiEligible:Boolean(serverEnv.tiktokVideoPublishApproved&&serverEnv.tiktokPublishingRealMode&&a?.tokenReady&&a.publishGranted&&a.audit==="AUDITED"&&a.directPost==="READY"),publishedToday:Number(facts.publishedToday??0),lastPublishedAt:[facts.lastPublishedAt,...(current.data?.slots as GrowthSlot[]??[]).map(s=>s.reportedAt??null)].filter((v):v is string=>Boolean(v)).toSorted().at(-1)??null,
    prior:prior.data?{count:Number(prior.data.decision.recommended),changedAt:prior.data.changed_at,evidenceIds:prior.data.decision.evidenceIds??[],reason:prior.data.decision.reason}:null};
  const decision=analyzeGrowth(config,policy,evidence,now);
  const permission=await accountAutoPermission(admin,owner,p.tiktok_account_id);
  if(!permission){decision.recommended=0;decision.action="OBSERVE";decision.reason="FOLLOWERS_UNKNOWN";}
  else if(permission.mode!=="GROWTH"){decision.recommended=0;decision.action="PAUSE";decision.reason="AFFILIATE_HANDOFF";}
  if(!p.enabled){decision.recommended=0;decision.action="PAUSE";decision.reason="PILOT_DISABLED";}
  // Manual reports cover preparation demand, but never count as verified API performance.
  const slots=growthSlots(owner,p.tiktok_account_id,config,policy,{...decision,recommended:Math.max(0,decision.recommended-manualReported-evidence.publishedToday)},now,`${p.tiktok_account_id}:${day}`);
  return{facts,config,policy,day,decision,slots,current:current.data?.slots as GrowthSlot[]|undefined};
}
export async function growthPilotView(admin:SupabaseClient,owner:string,now=new Date()):Promise<GrowthPilotView>{
  const c=await context(admin,owner,now);
  if(!c)return{available:false,active:false,message:"ยังไม่ได้เลือกบัญชีสำหรับทดลองฝั่งเซิร์ฟเวอร์"};
  return{available:true,active:c.facts.pilot.enabled,name:c.facts.account?.name??"บัญชีทดลอง",username:c.facts.account?.username??null,
    decision:{...c.decision,evidenceIds:[]},slots:c.decision.recommended>0?c.current??c.slots:(c.current??[]).filter(s=>s.state==="MANUAL_REPORTED"),message:decisionLabel(c.decision),manualReportedToday:c.current?.filter(s=>s.state==="MANUAL_REPORTED").length??0};
}
/** No video submit, paid provider, token or TikTok publishing call exists in this Pilot path. */
export async function prepareGrowthPilot(admin:SupabaseClient,owner:string,now=new Date()){
  const c=await context(admin,owner,now);if(!c||!c.facts.pilot.enabled)throw new Error("GROWTH_NOT_AUTHORIZED");
  const hash=createHash("sha256").update(JSON.stringify({decision:c.decision,slots:c.slots})).digest("hex");
  const saved=await admin.rpc("save_growth_pilot_plan",{p_owner:owner,p_day:c.day,p_decision:c.decision,p_slots:c.slots,p_hash:hash});check(saved.error);
  if(saved.data!==true)throw new Error("GROWTH_PERMISSION_CHANGED");return growthPilotView(admin,owner,now);
}
export async function setGrowthPilotEnabled(admin:SupabaseClient,owner:string,enabled:boolean,healthConfirmed:boolean){
  const c=await context(admin,owner,new Date());if(!c)throw new Error("GROWTH_NOT_AUTHORIZED");
  if(enabled&&!healthConfirmed)throw new Error("GROWTH_CONFIRMATION_REQUIRED");
  if(enabled){const pending=await admin.from("generation_budget_reservations").select("state").eq("owner_id",owner).eq("tiktok_account_id",c.facts.pilot.tiktok_account_id).eq("state","RESERVED").limit(1);check(pending.error);if(pending.data?.length)throw new Error("GROWTH_PENDING_PURCHASE");}
  const saved=await admin.from("growth_pilot_allowlist").update({enabled,health_confirmed:healthConfirmed,started_at:c.facts.pilot.started_at??new Date().toISOString()}).eq("singleton",true).eq("owner_id",owner).eq("tiktok_account_id",c.facts.pilot.tiktok_account_id).select("singleton").maybeSingle();check(saved.error);if(!saved.data)throw new Error("GROWTH_NOT_AUTHORIZED");
  return enabled?prepareGrowthPilot(admin,owner):growthPilotView(admin,owner);
}
export async function tickGrowthPilot(admin:SupabaseClient,pilot:Pilot){
  const permission=await accountAutoPermission(admin,pilot.owner_id,pilot.tiktok_account_id);
  if(permission?.mode==="AFFILIATE")return{disabled:false,safe:true,growthPilot:true,mode:"AFFILIATE",...await prepareAffiliateHandoff(admin,pilot.owner_id,pilot.tiktok_account_id),paidCalls:0,postingCalls:0};
  const view=await prepareGrowthPilot(admin,pilot.owner_id);return{disabled:false,safe:true,growthPilot:true,planned:view.slots?.length??0,paidCalls:0,postingCalls:0};
}

export async function reportGrowthManualPost(admin:SupabaseClient,owner:string,ordinal:number,url:string){
  const c=await context(admin,owner,new Date());if(!c||!c.facts.pilot.enabled)throw new Error("GROWTH_NOT_AUTHORIZED");
  const match=url.match(/^https:\/\/www\.tiktok\.com\/@([a-zA-Z0-9_.]+)\/video\/[0-9]{1,40}$/);
  if(!match||!c.facts.account.username||match[1].toLowerCase()!==c.facts.account.username.toLowerCase())throw new Error("GROWTH_POST_IDENTITY_REQUIRED");
  const saved=await admin.rpc("report_growth_pilot_manual_post",{p_owner:owner,p_day:c.day,p_ordinal:ordinal,p_url:url});check(saved.error);if(saved.data!==true)throw new Error("GROWTH_POST_NOT_RECORDED");
  return growthPilotView(admin,owner);
}

export function decisionLabel(decision:Pick<GrowthDecision,"action"|"reason">){
  const extra:Record<string,string>={FOLLOWERS_UNKNOWN:"รอข้อมูลผู้ติดตามที่ยืนยันได้",AFFILIATE_HANDOFF:"เปลี่ยนสู่โหมดขายแล้ว กำลังเตรียมงานจากสินค้าที่มีข้อมูลและสิทธิ์จริง",NO_AUTHORIZED_TOPIC_DATA:"รอข้อมูลหัวข้อจากแหล่งที่ได้รับอนุญาต",QUALITY_SIGNAL_DECLINE:"คุณภาพการรับชมลดลง จึงยังไม่เพิ่มความถี่",NO_MEASURABLE_RESPONSE:"ยังไม่เห็นผลตอบรับที่วัดได้ กรุณาตรวจบัญชี"};
  if(extra[decision.reason])return extra[decision.reason];
  const labels:Record<string,string>={OPT_IN_EXPERIMENT:"เริ่มทดลองเล็กน้อยตามนโยบายที่คุณอนุญาต ยังไม่ใช่จำนวนโพสต์ที่รับรองว่าปลอดภัย",SMALL_SAMPLE:"ผลลัพธ์ยังน้อย ทดลองอย่างระมัดระวังและรอข้อมูล",CONSISTENT_IMPROVEMENT:"หลายคลิปมีผลตอบรับดีต่อเนื่อง จึงปรับเพิ่มทีละน้อย",SUSTAINED_DECLINE:"ผลตอบรับลดลงต่อเนื่อง จึงลดหรือพักการโพสต์",LIMIT_UNKNOWN_NO_INCREASE:"ยังไม่ทราบขีดจำกัดจริง จึงไม่เพิ่มความถี่",ACCOUNT_HEALTH:"บัญชีมีสัญญาณเตือน กรุณาตรวจใน TikTok",HEALTH_UNKNOWN:"ต้องยืนยันว่าบัญชีพร้อมทดลองก่อน",PILOT_DISABLED:"พักการทดลองแล้ว",STABLE_OR_INSUFFICIENT_CHANGE:"รักษาจังหวะเดิม รอข้อมูลใหม่ที่เชื่อถือได้"};
  return labels[decision.reason]??"รอประเมินจากข้อมูลจริง";
}
