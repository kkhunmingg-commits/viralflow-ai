/* Same evidence, two Creative Brains: the rule-based storyteller and the local LLM.
 * Each runs CYCLES planning rounds for one Growth account, remembering what it published, like a real channel.
 * Pure planning: no database, no rendering, no network, no paid API. Machine time is the only cost.
 * Run: node --import ./scripts/pilot/server-only-shim.mjs --import tsx scripts/pilot/ai-vs-rules.ts <out-dir> */
import {mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {runCreativeAgent} from "../../src/features/creative/agent";
import {configuredLocalLLM,storyDigest} from "../../src/features/creative/local-agent";
import {planCreativeStrategy,type CreativeStrategyInput,type CreativeStrategyPlan} from "../../src/features/creative/strategist";
import {EMPTY_HISTORY,type StoryHistory} from "../../src/features/creative/storyteller";
import {GROWTH_TOPICS} from "./topics";

const [outDir]=process.argv.slice(2);
const CYCLES=Number(process.env.COMPARE_CYCLES??5),MACHINE_THB_PER_HOUR=6;
const log=(step:string,detail:unknown)=>console.log(JSON.stringify({step,...(detail as object)}));

const facts=GROWTH_TOPICS.flatMap((t,ti)=>t.facts.map((text,i)=>({id:`fact-${ti}-${i}`,text,topic:t.topic,source:"AUTHORIZED_SOURCE" as const,
  reference:t.source,verified:true,capturedAt:new Date(Date.now()-86400000+ti*60000+i*1000).toISOString(),role:"OBSERVATION" as const})));
const factTexts=new Set(facts.map(f=>f.text));

interface Cycle{cycle:number;topic:string|null;format:string|null;hook:string;beats:string[];selectedReady:boolean;selectedStatus:string;usedFallback:boolean;
  ideas:number;ideasReady:number;ideasRejected:number;distinctTopicsInRound:number;rejections:string[];seconds:number;tokens:{input:number;output:number}|null;
  selectionReason:string|null;brainstorm:string|null;allIdeas:Array<{id:string;status:string;topic:string|null;format:string|null;hook:string;beats:string[]|null}>}

function remember(history:StoryHistory,topic:string|null,format:string,hook:string,beats:string[]):StoryHistory{
  return {formats:[format,...history.formats],hooks:[hook,...history.hooks],topics:topic?[topic,...history.topics]:history.topics,
    lines:[...beats,...(history.lines??[])],stories:[{topic,format},...(history.stories??[])]};
}
const input=(history:StoryHistory,i:number):CreativeStrategyInput=>({now:new Date(Date.now()+i*1000),account:{id:"compare-growth",mode:"GROWTH",affiliateEligible:null},
  facts,assets:[],history});

function record(plan:CreativeStrategyPlan,cycle:number,seconds:number,extra:Partial<Cycle>&{topicOf?:(id:string)=>string|null}={}):Cycle{
  // A real run renders the model's own pick if it passes; otherwise the first idea that passed, which is flagged.
  const own=plan.concepts.find(c=>c.id===plan.selectedConceptId)!,ready=own.status==="REVIEW_REQUIRED";
  const chosen=ready?own:plan.concepts.find(c=>c.status==="REVIEW_REQUIRED")??own;
  const topicOf=extra.topicOf??(()=>plan.topic??null);
  return {cycle,topic:topicOf(chosen.id),format:chosen.production.story?.format??null,hook:chosen.concept.hook,beats:chosen.production.story?.beats.map(b=>b.text)??[],
    selectedReady:ready,selectedStatus:own.status,usedFallback:chosen!==own,ideas:plan.concepts.length,
    ideasReady:plan.concepts.filter(c=>c.status==="REVIEW_REQUIRED").length,ideasRejected:plan.concepts.filter(c=>c.status==="REJECTED").length,
    distinctTopicsInRound:new Set(plan.concepts.map(c=>topicOf(c.id))).size,
    rejections:plan.concepts.filter(c=>c.status!=="REVIEW_REQUIRED").flatMap(c=>[...c.reasons.slice(-3),...c.production.missingEvidence].map(r=>`${c.id}: ${r}`)),
    seconds,tokens:null,selectionReason:null,brainstorm:null,
    allIdeas:plan.concepts.map(c=>({id:c.id,status:c.status,topic:topicOf(c.id),format:c.production.story?.format??null,hook:c.concept.hook,beats:c.production.story?.beats.map(b=>b.text)??null})),...extra};
}

function summary(cycles:Cycle[]){
  const usable=cycles.filter(c=>c.selectedReady||c.usedFallback&&c.beats.length);
  const points=usable.flatMap(c=>c.beats.slice(1,-1));
  const digests=usable.map(c=>storyDigest({format:"EXPLAINER",basis:"",beats:c.beats.map(text=>({role:"POINT",text}))}));
  const seconds=cycles.reduce((a,c)=>a+c.seconds,0);
  return {cycles:cycles.length,ownPickPassedGates:cycles.filter(c=>c.selectedReady).length,neededFallback:cycles.filter(c=>c.usedFallback).length,
    noUsableIdea:cycles.length-usable.length,
    ideasProposed:cycles.reduce((a,c)=>a+c.ideas,0),ideasPassed:cycles.reduce((a,c)=>a+c.ideasReady,0),ideasRejected:cycles.reduce((a,c)=>a+c.ideasRejected,0),
    uniqueTopics:new Set(usable.map(c=>c.topic)).size,uniqueFormats:new Set(usable.map(c=>c.format)).size,uniqueHooks:new Set(usable.map(c=>c.hook)).size,
    repeatedStories:digests.length-new Set(digests).size,
    // Rule-based copy reads facts out verbatim; a writer paraphrases. Both are checked against the same facts.
    pointsVerbatimFromFacts:points.length?Number((points.filter(p=>factTexts.has(p)).length/points.length).toFixed(2)):null,
    machineSeconds:Number(seconds.toFixed(1)),actualCostThb:0,estimatedMachineThb:Number((seconds/3600*MACHINE_THB_PER_HOUR).toFixed(3)),
    tokens:cycles.some(c=>c.tokens)?cycles.reduce((a,c)=>({input:a.input+(c.tokens?.input??0),output:a.output+(c.tokens?.output??0)}),{input:0,output:0}):null};
}

async function main(){
  await mkdir(outDir,{recursive:true});
  const provider=configuredLocalLLM();
  if(!provider)throw new Error("Set LOCAL_LLM_PYTHON and LOCAL_LLM_MODEL_PATH to run the local model");
  const rules:Cycle[]=[],ai:Cycle[]=[];
  let rh:StoryHistory=EMPTY_HISTORY,ah:StoryHistory=EMPTY_HISTORY;
  for(let i=0;i<CYCLES;i++){
    let t=Date.now();const rp=planCreativeStrategy(input(rh,i)),r=record(rp,i+1,(Date.now()-t)/1000);rules.push(r);
    if(r.beats.length)rh=remember(rh,r.topic,r.format??"EXPLAINER",r.hook,r.beats);
    log("rules.cycle",r);
    t=Date.now();
    try{
      const g=await runCreativeAgent(input(ah,i),provider);
      const topicOf=(id:string)=>g.output.concepts.find(c=>c.id===id)?.topic??null;
      const raw=g.raw as {brainstorm?:string}|null;
      const a=record(g.plan,i+1,(Date.now()-t)/1000,{topicOf,tokens:{input:g.usage.inputTokens,output:g.usage.outputTokens},selectionReason:g.output.selectionReason,brainstorm:raw?.brainstorm??null});
      ai.push(a);if(a.beats.length)ah=remember(ah,a.topic,a.format??"EXPLAINER",a.hook,a.beats);
      log("ai.cycle",a);
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      ai.push({cycle:i+1,topic:null,format:null,hook:"",beats:[],selectedReady:false,selectedStatus:"ERROR",usedFallback:false,ideas:0,ideasReady:0,ideasRejected:0,
        distinctTopicsInRound:0,rejections:[message],seconds:(Date.now()-t)/1000,tokens:null,selectionReason:null,brainstorm:null,allIdeas:[]});
      log("ai.failed",{cycle:i+1,message});
    }
  }
  const report={ranAt:new Date().toISOString(),model:provider.model,evidence:{topics:GROWTH_TOPICS.length,facts:facts.length,note:"Same facts and empty trend/learning data for both systems"},
    assumptions:{machineThbPerHour:MACHINE_THB_PER_HOUR,note:"Estimate only; runner time is not billed. Human watchability review is separate and not part of these numbers."},
    rules:{mode:"RULE_BASED_STORYTELLER_V1",summary:summary(rules),cycles:rules},ai:{mode:"LOCAL_LLM_STORY_V1",summary:summary(ai),cycles:ai}};
  await writeFile(join(outDir,"ai-vs-rules.json"),JSON.stringify(report,null,2));
  log("summary",{rules:report.rules.summary,ai:report.ai.summary});
}
main().catch(error=>{console.error(error);process.exit(1)});
