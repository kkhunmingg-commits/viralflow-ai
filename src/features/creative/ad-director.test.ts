import {describe,expect,it} from "vitest";
import {critiqueConcepts,directAd,heuristicConcepts,buildConsumerInsight,type DirectorInput} from "./ad-director";
import {buildStoryboard,validateStoryboard} from "./storyboard";
import {compileFlowPlan} from "../video/flow-prompt-compiler";
import type {StructuredCreativeProvider} from "./providers";

const casio:DirectorInput={product:{id:"p",title:"Casio F-91W",categoryKey:"watch",model:"F-91W"},
  facts:[{id:"f1",text:"นาฬิกาดิจิทัล"},{id:"f2",text:"น้ำหนัก 21 กรัม"}],assets:[{id:"img",kind:"REAL_IMAGE",rightsCleared:true,credit:"credit"}],
  account:{id:"acc",mode:"GROWTH",affiliateEligible:false}};
const other=(categoryKey:string,title:string):DirectorInput=>({...casio,product:{id:title,title,categoryKey},facts:[{id:"g1",text:"ขนาด 30 มล."}],
  account:{id:"acc",mode:"AFFILIATE",affiliateEligible:true}});

describe("creative director",()=>{
  it("marks audience insight as hypothesis and differentiators as evidenced facts",()=>{
    const insight=buildConsumerInsight(casio);
    expect(insight.category).toBe("WATCH_ACCESSORY");
    expect(insight.audience.every(a=>a.status==="HYPOTHESIS")).toBe(true);
    expect(insight.differentiators.map(d=>[d.text,d.status])).toEqual([["น้ำหนัก 21 กรัม","EVIDENCED"],["นาฬิกาดิจิทัล","EVIDENCED"]]);
  });
  it("creates at least three meaningfully different concepts and picks one that passed",async()=>{
    const plan=await directAd(casio);
    expect(plan.mode).toBe("DIRECTOR_HEURISTIC");
    expect(new Set(plan.concepts.map(c=>c.format)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(plan.concepts.map(c=>c.hook.text)).size).toBe(plan.concepts.length);
    expect(plan.critiques.find(c=>c.conceptId===plan.selectedConceptId)?.passed).toBe(true);
    expect(plan.scoreMeaning).toContain("ไม่ใช่การทำนายยอดวิว");
    // No cart CTA for an account without affiliate rights.
    expect(plan.concepts.some(c=>/ตะกร้า/.test(c.cta))).toBe(false);
  });
  it("does not push every category through the same template",()=>{
    const watch=heuristicConcepts(casio,buildConsumerInsight(casio)).map(c=>c.format);
    const beauty=heuristicConcepts(other("beauty","Serum"),buildConsumerInsight(other("beauty","Serum"))).map(c=>c.format);
    const home=heuristicConcepts(other("home","Organizer"),buildConsumerInsight(other("home","Organizer"))).map(c=>c.format);
    expect(watch[0]).not.toBe(beauty[0]);expect(home[0]).not.toBe(watch[0]);
    expect(heuristicConcepts(other("beauty","Serum"),buildConsumerInsight(other("beauty","Serum"))).find(c=>c.format==="ASMR_SENSORY")?.feasible).toBe(false);
  });
  it("fails concepts with forbidden or unsupported claims and the wrong CTA",()=>{
    const [concept]=heuristicConcepts(casio,buildConsumerInsight(casio));
    const bad=[{...concept,id:"bad1",hook:{...concept.hook,text:"ขายดีที่สุด กันน้ำ 100 เมตร"}},{...concept,id:"bad2",cta:"กดตะกร้าเลย"},
      {...concept,id:"bad3",sellingPoints:[{factId:"f2",text:"น้ำหนัก 15 กรัม"}]}];
    const critiques=critiqueConcepts(bad,casio);
    expect(critiques.every(c=>!c.passed)).toBe(true);
    expect(critiques[0].scores.claimAccuracy).toBe(0);expect(critiques[1].scores.accountFit).toBe(0);expect(critiques[2].scores.claimAccuracy).toBe(0);
  });
  it("uses a model's ideas only through the same gates and records a model failure",async()=>{
    const provider:StructuredCreativeProvider={provider:"local-llm",model:"local/test",generateStructured:async()=>({raw:{},usage:{inputTokens:10,outputTokens:20},
      output:{concepts:[{format:"LIFESTYLE",audience:"คนทำงาน",insight:"อยากได้ของเบา",hookText:"วันยุ่ง ๆ ข้อมือเบาไว้ก่อน",hookVisual:"desk",factIds:["f2","invented"],angle:"เบา"},
        {format:"CINEMATIC_HERO",audience:"สายเรโทร",insight:"ชอบคลาสสิก",hookText:"คลาสสิกที่ยังอยู่",hookVisual:"light",factIds:["f1"],angle:"คลาสสิก"},
        {format:"CURIOSITY",audience:"คนทั่วไป",insight:"สงสัย",hookText:"หน้าปัดนี้บอกอะไร?",hookVisual:"macro",factIds:[],angle:"สงสัย"}]}})};
    const plan=await directAd(casio,provider);
    expect(plan.mode).toBe("INTELLIGENT_LLM");
    const llm=plan.concepts.find(c=>c.source==="LLM"&&c.format==="LIFESTYLE")!;
    expect(llm.sellingPoints).toEqual([{factId:"f2",text:"น้ำหนัก 21 กรัม"}]);
    const failing:StructuredCreativeProvider={...provider,generateStructured:async()=>{throw new Error("CREATIVE_LLM_TIMEOUT")}};
    const fallback=await directAd(casio,failing);
    expect(fallback.mode).toBe("DIRECTOR_HEURISTIC");expect(fallback.modeReason).toContain("CREATIVE_LLM_TIMEOUT");
  });
});

describe("storyboard and Flow compiler",()=>{
  it("plans hook, benefit and CTA with distinct visuals instead of one push-in",async()=>{
    const plan=await directAd(casio),concept=plan.concepts.find(c=>c.format==="LIFESTYLE")!;
    const board=buildStoryboard(concept,casio);
    expect(board.scenes[0]).toMatchObject({role:"HOOK",start:0});expect(board.scenes.at(-1)!.end).toBe(8);
    expect(new Set(board.scenes.map(s=>s.layout)).size).toBeGreaterThanOrEqual(3);
    expect(board.scenes.some(s=>s.evidenceIds.includes("f2"))).toBe(true);
    expect(validateStoryboard(board,casio)).toEqual([]);
    const flow=compileFlowPlan(board,"Casio F-91W",{maxGenerations:1,observedCreditsPerGeneration:10});
    expect(flow.requests).toHaveLength(1);expect(flow.estimatedCredits).toBe(10);expect(flow.requiresOwnerApproval).toBe(true);
    expect(flow.requests[0].prompt).toContain("DO NOT SHOW");expect(flow.requests[0].sections.negative.join(" ")).toContain("Casio F-91W");
    expect(flow.requests[0].sections.negative.join(" ")).toMatch(/watch faces, digits/);
  });
  it("adapts the scene count to longer edits and needs no Flow for product-only formats",async()=>{
    const plan=await directAd(casio),detail=plan.concepts.find(c=>c.format==="PRODUCT_DETAIL")!;
    const short=buildStoryboard(detail,casio),long=buildStoryboard(detail,casio,{durationSeconds:16});
    expect(long.scenes.length).toBeGreaterThan(short.scenes.length);expect(long.scenes.at(-1)!.end).toBe(16);
    expect(compileFlowPlan(short,"Casio F-91W",{maxGenerations:1,observedCreditsPerGeneration:10}).generations).toBe(0);
    expect(()=>buildStoryboard(detail,{...casio,assets:[]})).toThrow("STORYBOARD_REQUIRES_CLEARED_PRODUCT_MEDIA");
  });
  it("rejects storyboards with invented figures, uncleared media or a single repeated move",async()=>{
    const plan=await directAd(casio),board=buildStoryboard(plan.concepts.find(c=>c.format==="PRODUCT_DETAIL")!,casio);
    const tampered={...board,scenes:board.scenes.map((s,i)=>i===1?{...s,onScreen:{...s.onScreen,headline:"กันน้ำ 50 เมตร"}}:{...s,camera:"SLOW_PUSH" as const})};
    const codes=validateStoryboard({...tampered,scenes:tampered.scenes.map(s=>({...s,camera:"SLOW_PUSH" as const}))},{...casio,assets:[{id:"img",kind:"REAL_IMAGE",rightsCleared:false}]}).map(i=>i.code);
    expect(codes).toEqual(expect.arrayContaining(["UNSUPPORTED_FIGURE","ASSET_RIGHTS","SINGLE_CAMERA_MOVE"]));
  });
});
