import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { getOwnerAccounts } from "@/features/accounts/queries";
import { liveCandidates, postedProducts } from "@/features/ai-live/lineup-service";
import { liveBlockStart, praewProducts, selectLiveLineup } from "@/features/ai-live/live-director";
import { createClient } from "@/lib/supabase/server";
import { LivePlan } from "./live-plan";
import { OverlayEditor } from "./overlay-editor";
import { LivePresenterConsole } from "./presenter-console";
import { PraewControl } from "./praew-control";
import { PresenterStudio } from "./presenter-studio";
import "./ai-live.css";

export const metadata: Metadata = { title: "AI LIVE" };

export default async function AiLivePage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) redirect("/login");
  const { msg } = await searchParams;

  const blockStart = liveBlockStart();
  const [accounts, productsResult, candidates, posted] = await Promise.all([
    getOwnerAccounts(client, data.user.id),
    client.from("products").select("id,title").eq("owner_id", data.user.id).eq("status", "available").order("title").limit(100),
    liveCandidates(client, data.user.id, blockStart),
    postedProducts(client, data.user.id),
  ]);
  const lineup = selectLiveLineup(candidates, blockStart);
  if (productsResult.error) throw productsResult.error;

  const connectedAccounts = accounts
    .filter((account) => !account.is_mock && account.authorization_status === "authorized")
    .map((account) => ({ id: account.id, label: account.username ? `@${account.username}` : account.display_name }));

  return <>
    <PageHeading eyebrow="AI LIVE" title="ไลฟ์ขายของด้วย AI"
      description="ระบบไลฟ์เดียว คุมจากหน้านี้ได้ทุกที่ ทั้งเริ่ม/หยุด พิมพ์ให้พูด สินค้า และคอมเมนต์ ภาพออกไป TikTok ผ่าน OBS เลือกตัวสร้างภาพได้: Pro (เนียน การ์ดจอแรง) หรือ Lite (คอมสเปคต่ำ)"
      action={<span className="phase-chip">ทดสอบ · ยังใช้เสียงทดสอบ</span>} />
    <PraewControl products={praewProducts(lineup, candidates, posted)} postedCount={posted.length} />
    <details className="praew-card lo-section" id="live-overlay" open>
      <summary>องค์ประกอบบนจอไลฟ์<small>ข้อความโปร · นาฬิกา · รูป · อีโมจิเด้ง · ป้ายสินค้าอัตโนมัติ — ขึ้นบนไลฟ์ผ่าน OBS</small></summary>
      <OverlayEditor />
    </details>
    <details className="ai-live-advanced" open={Boolean(msg)}>
      <summary>เครื่องมืออื่นของ AI LIVE<small>ลำดับสินค้า · สร้างพรีเซนเตอร์จาก Flow · ตัวต้นแบบเก่า</small></summary>
      <div>
        <LivePlan lineup={lineup} candidates={candidates} blockStart={blockStart} />
        <PresenterStudio owner={data.user.id} hasTikTok={accounts.length > 0} message={msg} />
        <LivePresenterConsole accounts={connectedAccounts} products={productsResult.data ?? []} />
      </div>
    </details>
  </>;
}
