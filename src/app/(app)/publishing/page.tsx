import Link from "next/link";
import { redirect } from "next/navigation";
import { listPublishingQueue } from "@/features/publishing/services";
import { parseOperationalPage } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";
import "./publishing.css";

function statusLabel(status: string) {
  if (status === "PUBLISHED") return "โพสต์แล้ว";
  if (["REVIEW_REQUIRED", "DRAFT"].includes(status)) return "รอคุณตรวจ";
  if (["FAILED", "REJECTED"].includes(status)) return "มีปัญหา";
  if (status === "CANCELLED") return "ยกเลิกแล้ว";
  return "กำลังดำเนินการ";
}

export default async function PublishingPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) redirect("/login");
  const page = parseOperationalPage((await searchParams).page);
  const { items, hasMore } = await listPublishingQueue(client, data.user.id, page);
  return <div className="customer-publishing">
    <header><Link href="/auto">← กลับหน้า Home</Link><h1>วิดีโอของคุณ</h1><p>ตรวจงานที่รออนุมัติและดูสถานะโพสต์ล่าสุด</p></header>
    <section className="customer-publishing-list" aria-label="รายการวิดีโอ">
      {items.length ? items.map((item) => <Link href={`/publishing/${item.id}`} key={item.id}>
        <span><strong>{item.account?.display_name ?? "บัญชี TikTok"}</strong>
          <small>{item.created_at ? new Date(item.created_at).toLocaleString("th-TH") : ""}</small></span>
        <span className="customer-publishing-status">{statusLabel(item.status)} →</span>
      </Link>) : <p>ยังไม่มีวิดีโอในรายการ</p>}
    </section>
    <nav className="customer-publishing-pages" aria-label="หน้ารายการวิดีโอ">
      {page > 1 && <Link href={`/publishing?page=${page - 1}`}>← ก่อนหน้า</Link>}
      {hasMore && <Link href={`/publishing?page=${page + 1}`}>ถัดไป →</Link>}
    </nav>
  </div>;
}
