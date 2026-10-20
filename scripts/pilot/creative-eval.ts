/* Creative Brain evaluation without voice or rendering: Rule-Based, the local LLM alone, and Hybrid
 * (LLM ideas through the gates, rule-based when none pass) on the same cases, from evidence the prompts were not tuned on.
 * Each case is one Growth planning decision with its own recent history. No database, no network, no paid API.
 * Run a shard:  EVAL_SHARD=0 EVAL_SHARDS=6 node --import ./scripts/pilot/server-only-shim.mjs --import tsx scripts/pilot/creative-eval.ts run <out-dir>
 * Merge shards: node --import tsx scripts/pilot/creative-eval.ts merge <out-dir> <shard-dir>... */
import {mkdir,readFile,readdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {runCreativeAgent} from "../../src/features/creative/agent";
import {copyQualityIssues} from "../../src/features/creative/copy-quality";
import {chooseHybrid} from "../../src/features/creative/hybrid";
import {configuredLocalLLM} from "../../src/features/creative/local-agent";
import {planCreativeStrategy,type CreativeStrategyInput,type CreativeStrategyPlan} from "../../src/features/creative/strategist";
import type {StoryHistory} from "../../src/features/creative/storyteller";
import {EVAL_TOPICS} from "./eval-topics";

const MACHINE_THB_PER_HOUR=6,CASES=Number(process.env.EVAL_CASES??24);
const log=(step:string,detail:unknown)=>console.log(JSON.stringify({step,...(detail as object)}));
const FORMATS=["QUIZ_REVEAL","EXPLAINER","NUMBER_SPOTLIGHT","LIST"];

/** Case n: five of the twelve topics, and 0–3 of them already told by the account (with the formats it used). */
export function evalCase(n:number){
  const topics=Array.from({length:5},(_,i)=>EVAL_TOPICS[(n*5+i)%EVAL_TOPICS.length]);
  const told=topics.slice(0,n%4);
  const history:StoryHistory={topics:told.map(t=>t.topic),formats:told.map((_,i)=>FORMATS[(n+i)%FORMATS.length]),
    hooks:told.map(t=>`${t.topic} แปลกตรงไหน?`),lines:told.map(t=>t.facts[0]),stories:told.map((t,i)=>({topic:t.topic,format:FORMATS[(n+i)%FORMATS.length]}))};
  const facts=topics.flatMap((t,ti)=>t.facts.map((text,i)=>({id:`e${n}-${ti}-${i}`,text,topic:t.topic,source:"AUTHORIZED_SOURCE" as const,reference:t.source,
    verified:true,capturedAt:new Date(Date.UTC(2026,9,19,0,ti,i)).toISOString(),role:"OBSERVATION" as const})));
  const input:CreativeStrategyInput={now:new Date(Date.UTC(2026,9,20,8,n)),account:{id:`eval-growth-${n}`,mode:"GROWTH",affiliateEligible:null},facts,assets:[],history};
  return {n,input,history,topics:topics.map(t=>t.topic),told:told.map(t=>t.topic)};
}

function chosen(plan:CreativeStrategyPlan,history:StoryHistory){
  const c=plan.concepts.find(x=>x.id===plan.selectedConceptId)!;
  const beats=c.production.story?.beats??[];
  const copy=copyQualityIssues(beats,"GROWTH",history);
  const passed=c.status==="REVIEW_REQUIRED"&&c.production.ready&&copy.length===0;
  return {id:c.id,passed,status:c.status,format:c.production.story?.format??null,hook:c.concept.hook,beats:beats.map(b=>b.text),
    issues:[...(c.status==="REVIEW_REQUIRED"?[]:c.reasons.slice(-4)),...c.production.missingEvidence,...copy]};
}

async function run(outDir:string){
  await mkdir(outDir,{recursive:true});
  const provider=configuredLocalLLM();
  if(!provider)throw new Error("Set LOCAL_LLM_PYTHON and LOCAL_LLM_MODEL_PATH to run the local model");
  const shard=Number(process.env.EVAL_SHARD??0),shards=Number(process.env.EVAL_SHARDS??1);
  const results=[];
  for(let n=shard;n<CASES;n+=shards){
    const c=evalCase(n);
    let t=performance.now();const rulePlan=planCreativeStrategy(c.input);const ruleMs=performance.now()-t;
    const rule=chosen(rulePlan,c.history);
    t=performance.now();
    let ai:Awaited<ReturnType<typeof runCreativeAgent>>|null=null,aiError:string|null=null;
    try{ai=await runCreativeAgent(c.input,provider)}catch(error){aiError=error instanceof Error?error.message:String(error)}
    const aiSeconds=(performance.now()-t)/1000;
    const own=ai?chosen(ai.plan,c.history):null;
    const ideas=ai?ai.output.concepts.map(i=>({id:i.id,topic:i.topic})):[];
    const hybrid=chooseHybrid(ai?{plan:ai.plan,ideas}:null,aiError,rulePlan,c.history);
    const final=chosen(hybrid.plan,c.history);
    const raw=ai?.raw as {revised?:unknown;first?:{wallSeconds?:number}}|undefined;
    const row={case:n,topics:c.topics,told:c.told,
      rule:{...rule,ms:Number(ruleMs.toFixed(2))},
      ai:{error:aiError,ownPick:own,ideasProposed:ai?.plan.concepts.length??0,
        ideasPassed:ai?ai.plan.concepts.filter(x=>x.status==="REVIEW_REQUIRED"&&x.production.ready).length:0,
        revised:Boolean(raw?.revised),seconds:Number(aiSeconds.toFixed(1)),tokens:ai?ai.usage:null,
        ideas:ai?ai.plan.concepts.map(x=>({id:x.id,status:x.status,hook:x.concept.hook,beats:x.production.story?.beats.map(b=>b.text)??[],
          issues:x.status==="REVIEW_REQUIRED"?[]:x.reasons.slice(-3)})):[]},
      hybrid:{source:hybrid.source,fallbackReason:hybrid.fallbackReason,ranking:hybrid.ranking,final}};
    log("eval.case",row);results.push(row);
  }
  await writeFile(join(outDir,`shard-${shard}.json`),JSON.stringify(results,null,2));
}

type Row=Awaited<ReturnType<typeof readShards>>[number];
async function readShards(dirs:string[]){
  const rows=[];
  for(const dir of dirs)for(const f of (await readdir(dir)).filter(f=>/^shard-\d+\.json$/.test(f)))rows.push(...JSON.parse(await readFile(join(dir,f),"utf8")));
  return (rows as Array<{case:number;rule:ReturnType<typeof chosen>&{ms:number};ai:{error:string|null;ownPick:ReturnType<typeof chosen>|null;ideasProposed:number;ideasPassed:number;
    revised:boolean;seconds:number;tokens:{inputTokens:number;outputTokens:number}|null};hybrid:{source:string;final:ReturnType<typeof chosen>}}>).sort((a,b)=>a.case-b.case);
}
function summarize(rows:Row[]){
  const n=rows.length,seconds=rows.reduce((a,r)=>a+r.ai.seconds,0);
  const distinct=(xs:Array<string|null>)=>new Set(xs.filter(Boolean)).size;
  const tokens=rows.reduce((a,r)=>({input:a.input+(r.ai.tokens?.inputTokens??0),output:a.output+(r.ai.tokens?.outputTokens??0)}),{input:0,output:0});
  const machine=(s:number)=>Number((s/3600*MACHINE_THB_PER_HOUR).toFixed(3));
  const hybridAi=rows.filter(r=>r.hybrid.source!=="RULE_FALLBACK");
  return {cases:n,
    ruleBased:{passed:rows.filter(r=>r.rule.passed).length,distinctFormats:distinct(rows.map(r=>r.rule.format)),distinctHooks:distinct(rows.map(r=>r.rule.hook)),
      thinkingSeconds:Number((rows.reduce((a,r)=>a+r.rule.ms,0)/1000).toFixed(3)),actualCostThb:0,estimatedMachineThb:0},
    qwen3_4b:{ownPickPassed:rows.filter(r=>r.ai.ownPick?.passed).length,failedToPlan:rows.filter(r=>r.ai.error).length,
      ideasProposed:rows.reduce((a,r)=>a+r.ai.ideasProposed,0),ideasPassed:rows.reduce((a,r)=>a+r.ai.ideasPassed,0),revisedPlans:rows.filter(r=>r.ai.revised).length,
      distinctFormats:distinct(rows.map(r=>r.ai.ownPick?.format??null)),thinkingSeconds:Number(seconds.toFixed(1)),secondsPerCase:Number((seconds/n).toFixed(1)),
      tokens,actualCostThb:0,estimatedMachineThb:machine(seconds),estimatedMachineThbPerCase:machine(seconds/n)},
    hybrid:{passed:rows.filter(r=>r.hybrid.final.passed).length,aiOwnPick:rows.filter(r=>r.hybrid.source==="AI_OWN_PICK").length,
      aiRanked:rows.filter(r=>r.hybrid.source==="AI_RANKED").length,ruleFallback:rows.filter(r=>r.hybrid.source==="RULE_FALLBACK").length,
      distinctFormats:distinct(rows.map(r=>r.hybrid.final.format)),aiShare:Number((hybridAi.length/n).toFixed(2)),
      thinkingSeconds:Number(seconds.toFixed(1)),actualCostThb:0,estimatedMachineThb:machine(seconds)},
    note:"passed = the produced idea passed every evidence gate and the copy-quality checks, judged by the same code for all three systems. Machine THB is an estimate at 6 THB/hour, not a bill."};
}

async function main(){
  const [mode,out,...dirs]=process.argv.slice(2);
  if(mode==="run")return run(out);
  if(mode==="merge"){
    const rows=await readShards(dirs),summary=summarize(rows);
    await mkdir(out,{recursive:true});
    await writeFile(join(out,"creative-eval.json"),JSON.stringify({ranAt:new Date().toISOString(),summary,rows},null,2));
    log("eval.summary",summary);return;
  }
  throw new Error("usage: creative-eval.ts run <out> | merge <out> <shard-dir>...");
}
main().catch(error=>{console.error(error);process.exit(1)});
