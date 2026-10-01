import { deviceHttp, deviceResponse } from "@/features/ai-live/device-http";
import { listLiveDevices } from "@/features/ai-live/device-registry";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return deviceHttp(request, false, async ({ registry, ownerId }) => deviceResponse({ devices: await listLiveDevices(registry, ownerId) }));
}
