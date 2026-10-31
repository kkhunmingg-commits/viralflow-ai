import { analyzeFrequency } from "../multi-account/adaptive";
import { accountAutomationSchema, type AccountAutomation } from "../multi-account/contracts";
import { MultiAccountPublishingScheduler, localDay } from "../multi-account/scheduler";
import type { GrowthDecision, GrowthEvidence, GrowthPost, GrowthSlot, PilotPolicy } from "./contracts";
import { growthCreativeBrief } from "./topics";

const median = (values: number[]) => { const sorted=values.toSorted((a,b)=>a-b), mid=Math.floor(sorted.length/2); return sorted.length?(sorted[mid]+sorted[Math.max(0,mid-(sorted.length%2?0:1))])/2:0; };
const known = (n: number | null | undefined) => n!==null && n!==undefined && Number.isFinite(n) && n>=0;
const meanMetric = (rows: GrowthPost[], key: "averageWatchTime"|"retention"|"completionRate") => {
  // Partial availability must not silently stand in for every post.
  if(!rows.length||rows.some(p=>!known(p[key])))return null;
  return rows.reduce((n,p)=>n+Number(p[key]),0)/rows.length;
};
export function analyzeGrowth(config: AccountAutomation, policy: PilotPolicy, evidence: GrowthEvidence, now: Date): GrowthDecision {
  const stamp=now.getTime(), latest=new Map<string,GrowthPost>();
  for(const p of evidence.posts){
    const captured=Date.parse(p.capturedAt),published=Date.parse(p.publishedAt);
    if(p.source!=="TIKTOK_DISPLAY"||!known(p.confidence)||p.confidence<=0||!Number.isFinite(captured)||!Number.isFinite(published)||captured>stamp||captured<published||stamp-captured>7*86400000||stamp-published>28*86400000||captured-published<policy.maturationHours*3600000||!known(p.views))continue;
    if(!latest.has(p.id)||Date.parse(latest.get(p.id)!.capturedAt)<captured)latest.set(p.id,p);
  }
  const posts=[...latest.values()].toSorted((a,b)=>a.publishedAt.localeCompare(b.publishedAt)), days=new Set(posts.map(p=>localDay(new Date(p.publishedAt),config.timezone)));
  const followers=evidence.followers.filter(f=>f.source==="TIKTOK_DISPLAY"&&known(f.count)&&Date.parse(f.at)<=stamp&&stamp-Date.parse(f.at)<=28*86400000).toSorted((a,b)=>a.at.localeCompare(b.at));
  const current=followers.at(-1), first=followers[0];
  const views=posts.reduce((n,p)=>n+Number(p.views),0), attributed=posts.length>0&&posts.every(p=>known(p.followersGained))?posts.reduce((n,p)=>n+Number(p.followersGained),0):null;
  const sum=(key:"likes"|"comments"|"shares")=>posts.length&&posts.every(p=>known(p[key]))?posts.reduce((n,p)=>n+Number(p[key]),0):null;
  const result:GrowthDecision={recommended:0,action:"OWNER_REVIEW",reason:"HEALTH_UNKNOWN",confidence:Math.min(1,posts.length/(policy.minimumPosts*2))*Math.min(1,days.size/policy.minimumDays),transport:evidence.publicApiEligible&&evidence.publishCap!==null?"API_REVIEW":"MANUAL_PUBLIC",evidenceIds:posts.map(p=>p.id),lastPublishedAt:evidence.lastPublishedAt??posts.at(-1)?.publishedAt??null,audienceMinutes:[],topics:[],metrics:{startingFollowers:first?.count??null,currentFollowers:current&&stamp-Date.parse(current.at)<=7*86400000?current.count:null,netFollowers:followers.length>=2&&current&&stamp-Date.parse(current.at)<=7*86400000?current.count-first.count:null,viewsPerClip:posts.length?views/posts.length:null,followersPer1000Views:attributed!==null&&views>0?attributed/views*1000:null,followerConversionRate:attributed!==null&&views>0?attributed/views:null,averageWatchTime:meanMetric(posts,"averageWatchTime"),retention:meanMetric(posts,"retention"),completionRate:meanMetric(posts,"completionRate"),likes:sum("likes"),comments:sum("comments"),shares:sum("shares"),publishedToday:evidence.publishedToday}};
  for(const name of new Set(posts.map(p=>p.topic).filter((s):s is string=>Boolean(s)))){
    const rows=posts.filter(p=>p.topic===name), v=rows.reduce((n,p)=>n+Number(p.views),0);
    result.topics.push({name,posts:rows.length,viewsPerClip:v/rows.length,followersPer1000Views:rows.every(p=>known(p.followersGained))&&v>0?rows.reduce((n,p)=>n+Number(p.followersGained),0)/v*1000:null});
  }
  // Missing follower attribution cannot be substituted with account-wide net change.
  if(evidence.accountHealth!=="READY"){result.action=evidence.accountHealth==="BLOCKED"?"PAUSE":"OWNER_REVIEW";result.reason=evidence.accountHealth==="UNKNOWN"?"HEALTH_UNKNOWN":"ACCOUNT_HEALTH";return result;}
  if(!policy.topics.length){result.action="OBSERVE";result.reason="NO_AUTHORIZED_TOPIC_DATA";return result;}
  const enough=posts.length>=policy.minimumPosts&&days.size>=policy.minimumDays;
  let count=evidence.prior?.count??policy.trialClips;
  // A data/permission wait is not a permanent zero quota. Resume only the small opted-in trial;
  // sustained performance pauses remain paused until reviewed rather than silently restarting.
  if(count===0&&["FOLLOWERS_UNKNOWN","NO_AUTHORIZED_TOPIC_DATA","HEALTH_UNKNOWN","ACCOUNT_HEALTH","PILOT_DISABLED"].includes(evidence.prior?.reason??""))count=policy.trialClips;
  if(!enough){result.action=evidence.prior?"OBSERVE":"COLD_START";result.reason=posts.length?"SMALL_SAMPLE":"OPT_IN_EXPERIMENT";count=Math.min(count,policy.trialClips);}
  else {
    const grouped=new Map<string,{posts:number;views:number;engagements:number}>();
    for(const p of posts){const day=localDay(new Date(p.publishedAt),config.timezone),row=grouped.get(day)??{posts:0,views:0,engagements:0};row.posts++;row.views+=Number(p.views);row.engagements+=Number(p.likes??0)+Number(p.comments??0)+Number(p.shares??0);grouped.set(day,row);}
    // Keep existing adaptive window/platform bounds; growth evidence uses medians to reject a single viral outlier.
    const base=analyzeFrequency(config,{history:[...grouped.values()],publishCap:evidence.publishCap??count,ready:0,candidates:0,estimatedUnitCost:null,paidPermitted:false,providerAutomated:false,measuredGenerationPerDay:null,accountHealthy:true});
    const half=Math.floor(posts.length/2),older=posts.slice(0,half),recent=posts.slice(half);
    const velocity=(p:GrowthPost)=>Number(p.views)/Math.max(policy.maturationHours,(Date.parse(p.capturedAt)-Date.parse(p.publishedAt))/3600000);
    const old=median(older.map(velocity)), fresh=median(recent.map(velocity)), ratio=old>0?fresh/old:null;
    const recentGood=recent.filter(p=>old>0&&velocity(p)>old*1.15).length/recent.length;
    const recentBad=recent.filter(p=>old>0&&velocity(p)<old*.65).length/recent.length;
    const cooldown=evidence.prior&&stamp-Date.parse(evidence.prior.changedAt)<policy.cooldownDays*86400000;
    const newEvidence=!evidence.prior||recent.filter(p=>!evidence.prior!.evidenceIds.includes(p.id)).length>=3;
    result.action="MAINTAIN";result.reason="STABLE_OR_INSUFFICIENT_CHANGE";
    const qualityDecline=(["averageWatchTime","retention","completionRate"] as const).some(key=>{
      if(posts.some(p=>!known(p[key])))return false;
      const before=median(older.map(p=>Number(p[key])));return before>0&&median(recent.map(p=>Number(p[key])))<before*.8;
    });
    const engagementKnown=posts.every(p=>known(p.likes)&&known(p.comments)&&known(p.shares));
    const engagement=(p:GrowthPost)=>(Number(p.likes)+Number(p.comments)+Number(p.shares))/Math.max(1,Number(p.views));
    const engagementBefore=engagementKnown?median(older.map(engagement)):null;
    const engagementDecline=engagementBefore!==null&&engagementBefore>0&&median(recent.map(engagement))<engagementBefore*.8;
    if(old===0&&fresh===0){count=0;result.action="OWNER_REVIEW";result.reason="NO_MEASURABLE_RESPONSE";}
    else if(ratio!==null&&ratio<.65&&recentBad>=.75&&newEvidence&&!cooldown){count=Math.max(0,count-1);result.action=count?"REDUCE":"PAUSE";result.reason="SUSTAINED_DECLINE";}
    else if(qualityDecline||engagementDecline){result.reason="QUALITY_SIGNAL_DECLINE";}
    else if(ratio!==null&&ratio>1.25&&recentGood>=.75&&!cooldown&&newEvidence&&evidence.publishCap!==null){count=Math.min(count+1,Math.max(count,base.publishing));result.action=count>(evidence.prior?.count??policy.trialClips)?"INCREASE":"MAINTAIN";result.reason="CONSISTENT_IMPROVEMENT";}
    else if(evidence.publishCap===null)result.reason="LIMIT_UNKNOWN_NO_INCREASE";
    // Audience preference requires repeat observations over multiple publication days per time bucket.
    const buckets=new Map<number,GrowthPost[]>();
    for(const p of posts){const parts=new Intl.DateTimeFormat("en",{timeZone:config.timezone,hour:'2-digit',hourCycle:'h23'}).format(new Date(p.publishedAt));const hour=Number(parts);buckets.set(hour,[...buckets.get(hour)??[],p]);}
    result.audienceMinutes=[...buckets].filter(([,rows])=>rows.length>=3&&new Set(rows.map(p=>localDay(new Date(p.publishedAt),config.timezone))).size>=3).sort((a,b)=>median(b[1].map(velocity))-median(a[1].map(velocity))).slice(0,3).map(([hour])=>hour*60);
  }
  const minutes=config.spreadFullDay?1440:new Set(config.windows.flatMap(w=>Array.from({length:w.end-w.start},(_,i)=>w.start+i))).size;
  count=Math.min(count,Math.floor(minutes/Math.max(config.minimumGapMinutes,policy.minimumGapMinutes)));
  if(evidence.publishCap!==null)count=Math.min(count,Math.max(0,evidence.publishCap));
  result.recommended=Math.max(0,count);
  return result;
}

export function growthSlots(owner:string,account:string,config:AccountAutomation,policy:PilotPolicy,decision:GrowthDecision,now:Date,seed:string):GrowthSlot[]{
  if(!policy.topics.length)return [];
  const c=accountAutomationSchema.parse({...config,enabled:true,paused:false,minimumGapMinutes:Math.max(config.minimumGapMinutes,policy.minimumGapMinutes),audienceMinutes:decision.audienceMinutes});
  const sortedTopics=decision.topics.filter(t=>t.posts>=3&&t.followersPer1000Views!==null&&policy.topics.includes(t.name)).toSorted((a,b)=>b.followersPer1000Views!-a.followersPer1000Views!).map(t=>t.name);
  // Test a different permitted time band each day when audience response is not yet known.
  const day=localDay(now,c.timezone), rotation=Math.floor(Date.parse(`${day}T00:00:00Z`)/86400000)%policy.topics.length;
  const topics=[...new Set([...sortedTopics,...policy.topics])];
  if(!decision.audienceMinutes.length&&decision.recommended===1){
    const allowed=Array.from({length:1440},(_,m)=>m).filter(m=>c.spreadFullDay||c.windows.some(w=>m>=w.start&&m<w.end));
    const band=Math.floor(Date.parse(`${day}T00:00:00Z`)/86400000)%3;
    const tested=allowed.slice(Math.floor(band*allowed.length/3),Math.floor((band+1)*allowed.length/3));
    if(tested.length){
      c.spreadFullDay=false;c.windows=[];
      for(const m of tested){const last=c.windows.at(-1);if(last?.end===m)last.end=m+1;else c.windows.push({start:m,end:m+1});}
    }
  }
  const floor=Math.max(now.getTime(),decision.lastPublishedAt?Date.parse(decision.lastPublishedAt)+c.minimumGapMinutes*60000:0);
  const scheduler=new MultiAccountPublishingScheduler();
  const accountInput={ownerId:owner,id:account,config:c,connected:true,hidden:false,ready:0,produced:0,published:0,publishCap:null,recommendation:{generation:decision.recommended,publishing:0,reason:decision.reason,confidence:decision.confidence},scheduleSeed:seed};
  let plan=scheduler.plan([accountInput],now,0).filter(s=>Date.parse(s.dueAt)>=floor);
  if(!plan.length&&decision.recommended>0){
    // If today's exploratory band has passed, use only the remaining owner-permitted window.
    const minute=Number(new Intl.DateTimeFormat('en',{timeZone:c.timezone,hour:'2-digit',hourCycle:'h23'}).format(new Date(floor)))*60+Number(new Intl.DateTimeFormat('en',{timeZone:c.timezone,minute:'2-digit'}).format(new Date(floor)))+1;
    if(localDay(new Date(floor),c.timezone)===day){c.spreadFullDay=false;c.windows=(config.spreadFullDay?[{start:0,end:1440}]:config.windows).map(w=>({start:Math.max(w.start,minute),end:w.end})).filter(w=>w.end>w.start);plan=scheduler.plan([accountInput],now,0).filter(s=>Date.parse(s.dueAt)>=floor);}
  }
  return plan.map((slot,i)=>{const topic=topics[(rotation+i)%topics.length];return{ordinal:slot.ordinal,at:slot.dueAt,topic,state:"ASSISTED",brief:growthCreativeBrief(topic)};});
}
