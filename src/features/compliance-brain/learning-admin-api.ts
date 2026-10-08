import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {z} from "zod";
import {readJsonBodyWithLimit,securityErrorResponse} from "@/lib/security/request";
import {isOfficialPlatformNoticeReference,recordComplianceFeedback} from "./learning";
import {refreshComplianceLearning} from "./learning-runtime";
import {requirePolicyAdmin} from "./store";
import type {PolicyAdminActor} from "./store";

const identity={ownerId:z.uuid(),decisionId:z.uuid(),eventKey:z.string().min(1).max(160),
  observedAt:z.iso.datetime({offset:true}).optional()};
const platformReference=z.string().max(2048).refine(isOfficialPlatformNoticeReference);
const command=z.discriminatedUnion("action",[
  z.object({action:z.literal("refresh"),policyVersion:z.string().min(1).max(120)}).strict(),
  z.object({action:z.literal("human_correction"),...identity}).strict(),
  z.object({action:z.literal("platform_notice"),...identity,
    eventType:z.enum(["platform_warning","violation","appeal_submitted","appeal_accepted","appeal_rejected","content_removed"]),
    platformEvidenceRef:platformReference,platformReasonCode:z.string().max(160).optional(),
    platformReasonText:z.string().max(4000).optional()}).strict(),
]);

export function createLearningAdminHandler(deps:{authenticate:()=>Promise<PolicyAdminActor|null>;adminClient:()=>SupabaseClient;
  rateLimit:(ownerId:string)=>Promise<void>}) {
  return async(request:Request)=>{
    let actor:PolicyAdminActor;
    try {actor=requirePolicyAdmin(await deps.authenticate());}
    catch {return Response.json({error:"not_authorized"},{status:403});}
    const origin=request.headers.get("origin");
    if(!origin||origin!==new URL(request.url).origin)return Response.json({error:"origin_not_allowed"},{status:403});
    try {
      await deps.rateLimit(actor.id);
      let input:unknown;
      try {input=JSON.parse(await readJsonBodyWithLimit(request,8192));}
      catch(error){return securityErrorResponse(error)??Response.json({error:"invalid_learning_command"},{status:400});}
      const parsed=command.safeParse(input);
      if(!parsed.success)return Response.json({error:"invalid_learning_command"},{status:400});
      const value=parsed.data,client=deps.adminClient();
      if(value.action==="refresh")return Response.json({ok:true,learning:await refreshComplianceLearning(client,value.policyVersion)},
        {headers:{"Cache-Control":"private, no-store"}});
      const {action,...feedback}=value;
      const result=await recordComplianceFeedback(client,action==="human_correction"
        ?{...feedback,eventType:"human_edit",source:"HUMAN_CORRECTION"}
        :{...feedback,eventType:value.action==="platform_notice"?value.eventType:"human_edit",source:"OFFICIAL_PLATFORM"},actor);
      return Response.json({ok:true,...result},{status:result.learningPending?202:200,headers:{"Cache-Control":"private, no-store"}});
    }catch(error){return securityErrorResponse(error)??Response.json({error:"learning_command_rejected"},{status:422});}
  };
}
