import {beforeEach,describe,expect,it,vi} from "vitest";

const mocks=vi.hoisted(()=>({getUser:vi.fn(),rateLimit:vi.fn(),save:vi.fn(),refresh:vi.fn(),configuration:vi.fn(),geminiHealth:vi.fn(),admin:{}}));
vi.mock("next/cache",()=>({revalidatePath:mocks.refresh}));
vi.mock("@/lib/supabase/server",()=>({createClient:vi.fn(async()=>({auth:{getUser:mocks.getUser}}))}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:vi.fn(()=>mocks.admin)}));
vi.mock("@/lib/server-env",()=>({serverEnv:{}}));
vi.mock("@/lib/security/rate-limit",()=>({enforceOwnerMutationRateLimit:mocks.rateLimit}));
vi.mock("@/features/video-provider/google-vids",()=>({GoogleVidsOmniProvider:class{}}));
vi.mock("@/features/video-provider/fal",()=>({RoutedFalProvider:class{}}));
vi.mock("@/features/video-provider/gemini",()=>({GeminiOmniProvider:class{health=mocks.geminiHealth;}}));
vi.mock("@/features/video-provider/service",()=>({saveProviderSettings:mocks.save,providerSettings:mocks.configuration,enqueueProviderVideo:vi.fn(),advanceProviderJob:vi.fn(),prepareGoogleHandoff:vi.fn(),beginProviderImport:vi.fn(),completeProviderImport:vi.fn(),reconcileGoogleNotSubmitted:vi.fn(),processProviderQueue:vi.fn(),resumeKnownProviderResult:vi.fn(),reconcileProviderBilling:vi.fn()}));

import {providerSettingsSchema} from "@/features/video-provider/contracts";
import {saveSettingsAction,testProviderAction} from "./actions";

const owner="22222222-2222-4222-8222-222222222222";
describe("video provider settings owner authorization and paid consent",()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.getUser.mockResolvedValue({data:{user:{id:owner,app_metadata:{viralflow_role:"admin"}}}});mocks.save.mockResolvedValue(undefined);mocks.configuration.mockResolvedValue({settings:providerSettingsSchema.parse({})});});
  it("blocks enabling Gemini paid execution without renewed explicit consent",async()=>{
    const settings=providerSettingsSchema.parse({mode:"GEMINI_ONLY",paidMode:true,maxCostUsd:2,dailyBudgetUsd:5,monthlyBudgetUsd:20});
    await expect(saveSettingsAction(settings,false)).rejects.toThrow("ยืนยันวงเงิน");
    expect(mocks.save).not.toHaveBeenCalled();expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("saves the chosen provider and caps only after authenticated owner consent",async()=>{
    const settings=providerSettingsSchema.parse({mode:"GEMINI_ONLY",paidMode:true,geminiInputMode:"TEXT_TO_VIDEO",maxCostUsd:2,dailyBudgetUsd:5,monthlyBudgetUsd:20});
    await saveSettingsAction(settings,true);
    expect(mocks.save).toHaveBeenCalledWith(mocks.admin,owner,settings);expect(mocks.refresh).toHaveBeenCalledWith("/video-factory/providers");
  });
  it("allows choosing the API while paid mode remains off",async()=>{
    const settings=providerSettingsSchema.parse({mode:"GEMINI_ONLY",paidMode:false});
    await saveSettingsAction(settings,false);
    expect(mocks.save).toHaveBeenCalledWith(mocks.admin,owner,settings);
  });
  it("rejects ordinary members even when they supply paid consent",async()=>{
    mocks.getUser.mockResolvedValue({data:{user:{id:owner,app_metadata:{viralflow_role:"member"}}}});
    await expect(saveSettingsAction(providerSettingsSchema.parse({}),true)).rejects.toThrow("PROVIDER_ADMIN_REQUIRED");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not claim billing readiness from a successful model metadata check",async()=>{
    mocks.geminiHealth.mockResolvedValue({keyConfigured:true,modelAvailable:true,billingVerified:false});
    const message=await testProviderAction("gemini_omni_api");
    expect(mocks.geminiHealth).toHaveBeenCalledOnce();expect(message).toContain("ยังไม่ยืนยัน Billing");expect(message).toContain("ไม่ได้สร้างคลิป");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
