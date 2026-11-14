import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { getOwnerAccounts } from "@/features/accounts/queries";
import { liveCandidates } from "@/features/ai-live/lineup-service";
import { liveBlockStart, selectLiveLineup } from "@/features/ai-live/live-director";
import { createClient } from "@/lib/supabase/server";
import { LivePlan } from "./live-plan";
import { LivePresenterConsole } from "./presenter-console";
import { PresenterStudio } from "./presenter-studio";
import "./ai-live.css";

export const metadata: Metadata = { title: "AI LIVE" };

export default async function AiLivePage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) redirect("/login");
  const { msg } = await searchParams;

  const blockStart = liveBlockStart();
  const [accounts, productsResult, candidates] = await Promise.all([
    getOwnerAccounts(client, data.user.id),
    client.from("products").select("id,title").eq("owner_id", data.user.id).eq("status", "available").order("title").limit(100),
    liveCandidates(client, data.user.id, blockStart),
  ]);
  if (productsResult.error) throw productsResult.error;

  const connectedAccounts = accounts
    .filter((account) => !account.is_mock && account.authorization_status === "authorized")
    .map((account) => ({ id: account.id, label: account.username ? `@${account.username}` : account.display_name }));

  return <>
    <PageHeading eyebrow="AI LIVE" title="ไลฟ์ขายของด้วย AI"
      description="ระบบเลือกสินค้าที่ขายดีจากคลิป 3–4 ตัว เปลี่ยนทุก 4 ชั่วโมง และตอบแชทจากข้อมูลสินค้าที่ยืนยันแล้ว ไลฟ์ตรงเข้า TikTok ไม่ใช้ OBS หรือ Stream key"
      action={<span className="phase-chip">รอ TikTok อนุมัติ LIVE API</span>} />
    <LivePlan lineup={selectLiveLineup(candidates, blockStart)} candidates={candidates} blockStart={blockStart} />
    <PresenterStudio owner={data.user.id} accounts={connectedAccounts} message={msg} />
    <LivePresenterConsole accounts={connectedAccounts} products={productsResult.data ?? []} />
  </>;
}
