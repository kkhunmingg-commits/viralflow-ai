"use server";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {serverEnv} from "@/lib/server-env";
import {enforceOwnerMutationRateLimit} from "@/lib/security/rate-limit";
import {assertProviderAdministrator} from "@/features/video-provider/access";
import {providerSettingsSchema,type ProviderSettings} from "@/features/video-provider/contracts";
import {GoogleVidsOmniProvider} from "@/features/video-provider/google-vids";
import {RoutedFalProvider} from "@/features/video-provider/fal";
import {saveProviderSettings,providerSettings,enqueueProviderVideo,advanceProviderJob,prepareGoogleHandoff,beginProviderImport,completeProviderImport,reconcileGoogleNotSubmitted,processProviderQueue,resumeKnownProviderResult,reconcileProviderBilling} from "@/features/video-provider/service";
const uuid=z.string().uuid();
async function auth(){
  const client=await createClient(),{data}=await client.auth.getUser();assertProviderAdministrator(data.user);
  await enforceOwnerMutationRateLimit("video-provider",data.user!.id);
  return{admin:createAdminClient(),owner:data.user!.id};
}
export async function saveSettingsAction(settings:ProviderSettings,paidConsent:boolean){
  const {admin,owner}=await auth(),parsed=providerSettingsSchema.parse(settings);
  if((parsed.paidFallback||parsed.mode==="FAL_ONLY")&&paidConsent!==true)throw new Error("กรุณายืนยันวงเงินก่อนอนุญาตบริการเสียเงิน");
  await saveProviderSettings(admin,owner,parsed);revalidatePath("/video-factory/providers");
}
export async function queueVideoAction(project:string){const {admin,owner}=await auth();const result=await enqueueProviderVideo(admin,owner,uuid.parse(project));revalidatePath("/video-factory/providers");return result.id as string;}
export async function advanceVideoAction(id:string){const {admin,owner}=await auth();await advanceProviderJob(admin,owner,uuid.parse(id));revalidatePath("/video-factory/providers");}
export async function observeKnownResultAction(id:string){const {admin,owner}=await auth();await resumeKnownProviderResult(admin,owner,uuid.parse(id));await advanceProviderJob(admin,owner,id);revalidatePath("/video-factory/providers");}
export async function reconcileBillingAction(id:string){const {admin,owner}=await auth();const cost=await reconcileProviderBilling(admin,owner,uuid.parse(id));revalidatePath("/video-factory/providers");return cost===null?"ยังไม่พบยอดเรียกเก็บที่ยืนยันได้ หรือ key ไม่มีสิทธิ์อ่าน Billing งบเดิมยังถูกกันไว้":`ยอดเรียกเก็บที่ยืนยันแล้ว $${cost.toFixed(4)}`;}
export async function googleBriefAction(id:string){const {admin,owner}=await auth();return prepareGoogleHandoff(admin,owner,uuid.parse(id));}
export async function uploadTicketAction(id:string,kind:"VIDEO"|"VOICE"){const {admin,owner}=await auth();return beginProviderImport(admin,owner,uuid.parse(id),z.enum(["VIDEO","VOICE"]).parse(kind));}
export async function importVideoAction(id:string,ownerAttestsGoogle:boolean){
  if(ownerAttestsGoogle!==true)throw new Error("กรุณายืนยันแหล่งที่มาของคลิป");const {admin,owner}=await auth();await completeProviderImport(admin,owner,uuid.parse(id));revalidatePath("/video-factory/providers");
}
export async function noGooglePendingAction(id:string,confirmed:boolean){
  if(confirmed!==true)throw new Error("ต้องยืนยันว่าไม่มีรายการ Google ค้างก่อน");const {admin,owner}=await auth();await reconcileGoogleNotSubmitted(admin,owner,uuid.parse(id));revalidatePath("/video-factory/providers");
}
export async function processQueueAction(){const {admin,owner}=await auth();const result=await processProviderQueue(admin,owner);revalidatePath("/video-factory/providers");return result;}
export async function testProviderAction(provider:"google_vids_omni"|"fal_ai"){
  const {admin,owner}=await auth(),{settings}=await providerSettings(admin,owner);
  if(provider==="google_vids_omni")return `Google Vids: ${new GoogleVidsOmniProvider().health(settings).status} (เจ้าของระบุ) — Assisted เท่านั้น ไม่ได้ทดสอบล็อกอินหรือโควตาบัญชี`;
  if(provider!=="fal_ai")throw new Error("ไม่พบบริการ");
  const request=await new RoutedFalProvider(serverEnv.falKey??"").prepare(settings.falModel,"https://example.invalid/product.jpg","Read-only price check; no generation");
  return `อ่านราคา fal สำเร็จ: ประมาณ $${request.estimateUsd.toFixed(4)} ต่อคำขอนี้ รวมเผื่อ 10% — ยังไม่ตรวจยอดเงิน/คุณภาพ/ยอดเรียกเก็บจริง และไม่สร้างคลิป`;
}
