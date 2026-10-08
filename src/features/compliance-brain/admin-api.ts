import type {SupabaseClient} from "@supabase/supabase-js";
import {z} from "zod";
import {activatePolicyVersion,requirePolicyAdmin} from "./store";
import type {PolicyAdminActor} from "./store";
import {readJsonBodyWithLimit,securityErrorResponse} from "@/lib/security/request";
const command=z.object({action:z.enum(["activate","deactivate","rollback"]),version:z.string().min(1).max(120)}).strict();
export interface PolicyConsoleData {policies:Array<{version:string;status:string;effective_at:string;activated_at:string|null;
  retired_at:string|null;validated_at:string|null;validation_hash:string|null;checksum:string;source_refs_json:unknown}>;learning:Record<string,unknown>[]}
export async function readPolicyConsole(client:SupabaseClient,actor:PolicyAdminActor):Promise<PolicyConsoleData> {
  requirePolicyAdmin(actor);
  const [policies,learning]=await Promise.all([client.from("compliance_brain_policy_versions")
    .select("version,status,effective_at,activated_at,retired_at,validated_at,validation_hash,checksum,source_refs_json").order("created_at",{ascending:false}).limit(100),
    client.rpc("read_compliance_brain_learning_patterns")]);
  if(policies.error||learning.error)throw new Error("compliance_console_unavailable");
  return {policies:policies.data??[],learning:(learning.data??[]) as Record<string,unknown>[]};
}
export async function applyPolicyCommand(client:SupabaseClient,actor:PolicyAdminActor,input:unknown,
  verify:(pack:unknown)=>{version:string;platform:string;country:string;region:string}) {
  requirePolicyAdmin(actor);const parsed=command.parse(input);
  if(parsed.action==="deactivate"){
    const result=await client.rpc("deactivate_compliance_brain_policy",{p_version:parsed.version,p_actor:actor.id});
    if(result.error)throw new Error("compliance_policy_deactivation_failed");
  }else await activatePolicyVersion(client,actor,parsed.version,verify,parsed.action==="rollback");
}
export function createPolicyAdminHandlers(deps:{authenticate:()=>Promise<PolicyAdminActor|null>;adminClient:()=>SupabaseClient;
  verify:(pack:unknown)=>{version:string;platform:string;country:string;region:string};rateLimit:(ownerId:string)=>Promise<void>}) {
  const authorized=async()=>{const actor=await deps.authenticate();if(!actor)return null;try{return requirePolicyAdmin(actor)}catch{return null}};
  return {GET:async()=>{
    const actor=await authorized();if(!actor)return Response.json({error:"not_authorized"},{status:403});
    try{return Response.json(await readPolicyConsole(deps.adminClient(),actor),{headers:{"Cache-Control":"private, no-store"}})}
    catch{return Response.json({error:"compliance_console_unavailable"},{status:503})}
  },POST:async(request:Request)=>{
    const actor=await authorized();if(!actor)return Response.json({error:"not_authorized"},{status:403});
    const origin=request.headers.get("origin");
    if(!origin||origin!==new URL(request.url).origin)return Response.json({error:"origin_not_allowed"},{status:403});
    try{
      await deps.rateLimit(actor.id);
      const parsed=command.safeParse(JSON.parse(await readJsonBodyWithLimit(request,4096)));
      if(!parsed.success)return Response.json({error:"invalid_policy_command"},{status:400});
      await applyPolicyCommand(deps.adminClient(),actor,parsed.data,deps.verify);
      return Response.json({ok:true},{headers:{"Cache-Control":"private, no-store"}});
    }catch(error){return securityErrorResponse(error)??Response.json({error:"policy_command_rejected"},{status:422})}
  }};
}
