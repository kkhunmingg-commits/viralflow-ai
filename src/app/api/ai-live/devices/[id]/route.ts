import { z } from "zod";
import { deviceHttp, deviceResponse } from "@/features/ai-live/device-http";
import { liveDeviceStatus, revokeLiveDevice } from "@/features/ai-live/device-registry";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, route: Context) {
  const id = z.uuid().safeParse((await route.params).id);
  if (!id.success) return deviceResponse({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  return deviceHttp(request, false, async ({ registry, ownerId, appMetadata }) => deviceResponse(await liveDeviceStatus(registry, ownerId, id.data, appMetadata)));
}
export async function DELETE(request: Request, route: Context) {
  const id = z.uuid().safeParse((await route.params).id);
  if (!id.success) return deviceResponse({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  return deviceHttp(request, true, async (context) => {
    if (!context.signingKey) return deviceResponse({ error: "การจัดการส่วนเสริมยังไม่พร้อม" }, 503);
    const result = await revokeLiveDevice({ ...context, deviceId: id.data, signingKey: context.signingKey });
    return result ? deviceResponse(result) : deviceResponse({ error: "ไม่พบส่วนเสริมที่เชื่อมกับบัญชีของคุณ" }, 404);
  });
}
