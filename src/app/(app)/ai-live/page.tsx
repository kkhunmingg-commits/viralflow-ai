import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { liveCandidates } from "@/features/ai-live/lineup-service";
import { liveBlockStart, selectLiveLineup } from "@/features/ai-live/live-director";
import { createClient } from "@/lib/supabase/server";
import { LivePlan } from "./live-plan";
import { PraewLivePanel } from "./praew-panel";
import "./ai-live.css";

export const metadata: Metadata = { title: "AI LIVE" };

export default async function AiLivePage() {
  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) redirect("/login");

  const blockStart = liveBlockStart();
  const candidates = await liveCandidates(client, data.user.id, blockStart);

  return <>
    <PageHeading eyebrow="AI LIVE" title="ไลฟ์ด้วยพิธีกร AI"
      description="แพรวรันบนคอมเครื่องนี้ ส่งภาพเข้า OBS หรือ TikTok LIVE Studio อ่านคอมเมนต์ TikTok แบบอ่านอย่างเดียว ด้านล่างคือแผนสินค้าสำหรับไลฟ์ขายของในอนาคต" />
    <PraewLivePanel />
    <LivePlan lineup={selectLiveLineup(candidates, blockStart)} candidates={candidates} blockStart={blockStart} />
  </>;
}
