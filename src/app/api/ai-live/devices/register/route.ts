import { deviceRegistrationSchema } from "@/features/ai-live/device-identity";
import { deviceHttp, deviceJsonBody, deviceResponse } from "@/features/ai-live/device-http";
import { registerLiveDevice } from "@/features/ai-live/device-registry";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return deviceHttp(request, true, async (context) => {
    const parsed = deviceRegistrationSchema.safeParse(await deviceJsonBody(request));
    if (!parsed.success) return deviceResponse({ error: "ข้อมูลส่วนเสริมไม่ถูกต้อง" }, 400);
    if (!context.signingKey) return deviceResponse({ error: "การเชื่อมส่วนเสริมยังไม่พร้อม" }, 503);
    const result = await registerLiveDevice({ ...context, proof: parsed.data, signingKey: context.signingKey });
    return result ? deviceResponse(result) : deviceResponse({ error: "ไม่สามารถอนุญาตเครื่องนี้ได้ กรุณาตรวจสอบแพ็กเกจและจำนวนเครื่อง" }, 403);
  });
}
