import { deviceChallengeRequestSchema } from "@/features/ai-live/device-identity";
import { deviceHttp, deviceJsonBody, deviceResponse } from "@/features/ai-live/device-http";
import { createDeviceChallenge } from "@/features/ai-live/device-registry";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return deviceHttp(request, true, async (context) => {
    const parsed = deviceChallengeRequestSchema.safeParse(await deviceJsonBody(request));
    if (!parsed.success) return deviceResponse({ error: "กรุณาอัปเดตส่วนเสริมและตรวจสอบข้อมูล" }, 400);
    if (!context.signingKey) return deviceResponse({ error: "การเชื่อมส่วนเสริมยังไม่พร้อม" }, 503);
    const challenge = await createDeviceChallenge({ ...context, deviceId: parsed.data.deviceId, signingKey: context.signingKey });
    return challenge ? deviceResponse(challenge) : deviceResponse({ error: "แพ็กเกจของคุณยังไม่รองรับ AI LIVE" }, 403);
  });
}
