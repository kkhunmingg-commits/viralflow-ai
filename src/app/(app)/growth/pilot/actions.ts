"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { growthPilotView, prepareGrowthPilot, reportGrowthManualPost, setGrowthPilotEnabled } from "@/features/growth-manager/service";
async function auth(){const client=await createClient(),{data}=await client.auth.getUser();if(!data.user)throw new Error("กรุณาเข้าสู่ระบบ");await enforceOwnerMutationRateLimit("growth-pilot",data.user.id);return{admin:createAdminClient(),owner:data.user.id};}
export async function refreshGrowthPilotAction(){const {admin,owner}=await auth();return growthPilotView(admin,owner);}
export async function prepareGrowthPilotAction(){const {admin,owner}=await auth();return prepareGrowthPilot(admin,owner);}
export async function enableGrowthPilotAction(enabled:boolean,confirmed:boolean){const {admin,owner}=await auth();return setGrowthPilotEnabled(admin,owner,z.boolean().parse(enabled),z.boolean().parse(confirmed));}
export async function reportGrowthPostAction(ordinal:number,url:string){const {admin,owner}=await auth();return reportGrowthManualPost(admin,owner,z.number().int().positive().parse(ordinal),z.string().max(300).parse(url));}
