"use server";import {revalidatePath} from "next/cache";import {redirect} from "next/navigation";import {z} from "zod";import {createAutoRun,transitionAutoRun} from "@/features/auto/services";import {createAdminClient} from "@/lib/supabase/admin";import {createClient} from "@/lib/supabase/server";import {enforceOwnerMutationRateLimit} from "@/lib/security/rate-limit";
async function owner(){const client=await createClient(),{data,error}=await client.auth.getUser();if(error||!data.user)throw new Error("Authentication required");await enforceOwnerMutationRateLimit("auto",data.user.id);return data.user.id}
export async function startAutoAction(requestKey:string){const run=await createAutoRun(createAdminClient(),await owner(),requestKey);revalidatePath("/auto");redirect(`/auto/runs/${run.id}`)}
const operatorSchema=z.object({accountId:z.uuid(),mode:z.enum(["AUTO","GROWTH","AFFILIATE"]),dailyTarget:z.coerce.number().int().min(1).max(20),dailyBudgetUsd:z.coerce.number().finite().min(0).max(1000),requestKey:z.uuid()});
export async function startOperatorAction(formData:FormData){
  const parsed=operatorSchema.safeParse(Object.fromEntries(formData));
  if(!parsed.success)redirect("/auto?setup=account");
  const ownerId=await owner();
  try{await createAutoRun(createAdminClient(),ownerId,parsed.data.requestKey,parsed.data)}
  catch(error){
    const code=error instanceof Error?error.message:"";
    if(code==="affiliate_not_eligible")redirect("/auto?setup=affiliate");
    if(["daily_target_exceeds_account_limit","operator_selection_exceeds_account_limits","invalid_operator_selection"].includes(code))redirect("/auto?setup=budget");
    if(code==="account_not_found")redirect("/auto?setup=account");
    throw error;
  }
  revalidatePath("/auto");revalidatePath("/dashboard");redirect("/auto");
}
export async function transitionAutoAction(id:string,action:"PAUSE"|"RESUME"|"STOP"){await transitionAutoRun(createAdminClient(),await owner(),id,action);revalidatePath("/auto");revalidatePath(`/auto/runs/${id}`)}
