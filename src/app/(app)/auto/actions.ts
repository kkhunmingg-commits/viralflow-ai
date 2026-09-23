"use server";import {revalidatePath} from "next/cache";import {redirect} from "next/navigation";import {after} from "next/server";import {z} from "zod";import {createAutoRun,transitionAutoRun} from "@/features/auto/services";import {runAutoExecutionCycle} from "@/features/auto/execution-service";import {persistDailyAssignments} from "@/features/assignments/services";import {assignmentDate} from "@/features/assignments/planner";import {createAdminClient} from "@/lib/supabase/admin";import {createClient} from "@/lib/supabase/server";import {enforceOwnerMutationRateLimit} from "@/lib/security/rate-limit";
async function owner(){const client=await createClient(),{data,error}=await client.auth.getUser();if(error||!data.user)throw new Error("Authentication required");await enforceOwnerMutationRateLimit("auto",data.user.id);return data.user.id}
function scheduleExecution(ownerId:string,runId:string){after(async()=>{try{await runAutoExecutionCycle(createAdminClient(),ownerId,runId)}catch{ /* Recovery scheduler can replay from the durable checkpoint. */ }})}
export async function startAutoAction(requestKey:string){
  const ownerId=await owner(),userClient=await createClient();
  const {count,error}=await userClient.from("product_assignments").select("id",{count:"exact",head:true})
    .eq("owner_id",ownerId).eq("assignment_date",assignmentDate(new Date().toISOString()))
    .in("status",["CANDIDATE","SELECTED","USED"]);
  if(error)throw new Error("assignment_check_failed");
  if(!count)await persistDailyAssignments(userClient,ownerId);
  const run=await createAutoRun(createAdminClient(),ownerId,requestKey);
  scheduleExecution(ownerId,run.id);revalidatePath("/auto");redirect(`/auto/runs/${run.id}`);
}
const operatorSchema=z.object({accountId:z.uuid(),mode:z.enum(["AUTO","GROWTH","AFFILIATE"]),dailyTarget:z.coerce.number().int().min(1).max(20),dailyBudgetUsd:z.coerce.number().finite().min(0).max(1000),requestKey:z.uuid()});
export async function startOperatorAction(formData:FormData){
  const parsed=operatorSchema.safeParse(Object.fromEntries(formData));
  if(!parsed.success)redirect("/auto?setup=account");
  const ownerId=await owner();
  let runId:string;
  try{
    const userClient=await createClient();
    const {count,error}=await userClient.from("product_assignments").select("id",{count:"exact",head:true})
      .eq("owner_id",ownerId).eq("tiktok_account_id",parsed.data.accountId)
      .eq("assignment_date",assignmentDate(new Date().toISOString())).in("status",["CANDIDATE","SELECTED","USED"]);
    if(error)throw new Error("assignment_check_failed");
    if(!count)await persistDailyAssignments(userClient,ownerId);
    const run=await createAutoRun(createAdminClient(),ownerId,parsed.data.requestKey,parsed.data);
    runId=run.id;
  }
  catch(error){
    const code=error instanceof Error?error.message:"";
    if(code==="affiliate_not_eligible")redirect("/auto?setup=affiliate");
    if(["daily_target_exceeds_account_limit","operator_selection_exceeds_account_limits","invalid_operator_selection"].includes(code))redirect("/auto?setup=budget");
    if(code==="account_not_found")redirect("/auto?setup=account");
    throw error;
  }
  scheduleExecution(ownerId,runId);
  revalidatePath("/auto");revalidatePath("/dashboard");redirect("/auto");
}
export async function transitionAutoAction(id:string,action:"PAUSE"|"RESUME"|"STOP"){const ownerId=await owner();await transitionAutoRun(createAdminClient(),ownerId,id,action);if(action==="RESUME")scheduleExecution(ownerId,id);revalidatePath("/auto");revalidatePath(`/auto/runs/${id}`)}
