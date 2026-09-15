import { z } from "zod";

export const ANGLE_TYPES = ["PROMOTION","PRICE_SHOCK","PROBLEM_SOLUTION","MUST_HAVE","REVIEW_DISCOVERY","POV","DEMONSTRATION","COMPARISON","URGENCY"] as const;
export const angleTypeSchema = z.enum(ANGLE_TYPES);
const timedText = z.object({start:z.number().min(0).max(8),end:z.number().min(0).max(8),text:z.string().trim().min(1).max(80)}).refine(v=>v.end>v.start,"End must follow start");
const scene = z.object({start:z.number().min(0).max(8),end:z.number().min(0).max(8),visual:z.string().trim().min(1).max(180),motion:z.string().trim().min(1).max(100)}).refine(v=>v.end>v.start,"End must follow start");

export const creativeConceptSchema = z.object({
  angleType:angleTypeSchema,title:z.string().trim().min(1).max(100),hook:z.string().trim().min(1).max(100),
  coreMessage:z.string().trim().min(1).max(180),voiceScript:z.string().trim().min(1).max(180),
  overlayText:z.array(timedText).min(1).max(5),scenePlan:z.array(scene).min(3).max(5),
  cta:z.string().trim().min(1).max(100),caption:z.string().trim().min(1).max(300),
  hashtags:z.array(z.string().trim().regex(/^#[^\s#]+$/)).min(2).max(8),
  visualStrategy:z.string().trim().min(1).max(240),
  modelSignals:z.object({hookStrength:z.number().min(0).max(100),novelty:z.number().min(0).max(100),visualFeasibility:z.number().min(0).max(100)}),
}).superRefine((value,ctx)=>{
  const scenes=value.scenePlan.toSorted((a,b)=>a.start-b.start);
  if(scenes[0]?.start!==0||scenes.at(-1)?.end!==8)ctx.addIssue({code:"custom",message:"Scene plan must cover 0–8 seconds",path:["scenePlan"]});
  scenes.slice(1).forEach((s,i)=>{if(Math.abs(s.start-scenes[i].end)>.001)ctx.addIssue({code:"custom",message:"Scenes must be contiguous",path:["scenePlan",i+1]});});
  if(value.overlayText.some(o=>o.end>8))ctx.addIssue({code:"custom",message:"Overlay extends beyond 8 seconds",path:["overlayText"]});
});
export const creativeOutputSchema=z.object({concepts:z.array(creativeConceptSchema).length(5)});
export type CreativeConcept=z.infer<typeof creativeConceptSchema>;
export type CreativeOutput=z.infer<typeof creativeOutputSchema>;

