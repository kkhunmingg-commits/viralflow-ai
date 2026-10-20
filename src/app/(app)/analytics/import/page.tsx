import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { createClient } from "@/lib/supabase/server";
import { ReportImportPanel, type ImportAccount } from "./import-panel";

export const metadata = { title: "นำเข้ารายงาน TikTok · Viral Flow AI" };
const kindLabel: Record<string, string> = { VIDEO_PERFORMANCE: "ผลวิดีโอ TikTok Studio", AFFILIATE_ORDERS: "คำสั่งซื้อ Affiliate" };

export default async function ReportImportPage() {
  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) redirect("/login?next=/analytics/import");
  const [accounts, batches] = await Promise.all([
    client.from("tiktok_accounts").select("id,display_name,username,is_mock,hidden_at").eq("owner_id", data.user.id).order("created_at", { ascending: true }),
    client.from("performance_import_batches").select("id,tiktok_account_id,kind,file_name,rows_read,rows_imported,rows_linked,imported_at")
      .eq("owner_id", data.user.id).order("imported_at", { ascending: false }).limit(10),
  ]);
  if (accounts.error) throw new Error("report_import_accounts_read_failed");
  const visible: ImportAccount[] = (accounts.data ?? []).filter(a => !a.hidden_at).map(a => ({
    id: String(a.id), name: String(a.display_name ?? a.username ?? "บัญชี TikTok"), username: a.username ? String(a.username) : null, mock: a.is_mock !== false,
  }));
  const names = new Map(visible.map(a => [a.id, a.name]));
  const recent = batches.error ? [] : batches.data ?? [];
  return <>
    <PageHeading eyebrow="OWNER REPORT IMPORT" title="นำเข้ารายงานจริงจาก TikTok"
      description="อัปโหลดไฟล์ที่ดาวน์โหลดจาก TikTok Studio หรือศูนย์ Affiliate ตรวจตัวอย่างก่อน แล้วค่อยกดยืนยันนำเข้า ไม่ต้องใช้ terminal หรือแก้ไฟล์"
      action={<Link className="secondary-action" href="/analytics">กลับหน้า Analytics</Link>} />
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">DATA SOURCE</p><h2>ข้อมูลที่นำเข้าคือรายงานจริงของคุณ</h2></div><span className="phase-chip">OWNER_REPORT_IMPORT</span></div>
      <p className="radar-note">ตัวเลขจากไฟล์นี้ถูกเก็บแยกเป็นแหล่ง <strong>OWNER_REPORT_IMPORT</strong> ไม่ปนกับข้อมูลที่ระบบดึงจาก TikTok API และไม่ปนกับข้อมูลจำลอง (MOCK)
        ค่าที่ไม่มีในรายงานจะเป็น &quot;ไม่ทราบ&quot; ไม่ถูกเติมเป็น 0 และยอดขายจากวิดีโอกับไลฟ์ถูกแยกตามช่องทางที่รายงานระบุ</p>
    </section>
    <ReportImportPanel accounts={visible} />
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">RECENT IMPORTS</p><h2>ไฟล์ที่นำเข้าล่าสุด</h2></div></div>
      {recent.length ? <div className="radar-table-wrap"><table className="radar-table"><thead><tr><th>เวลา</th><th>บัญชี</th><th>ประเภท</th><th>ไฟล์</th><th>อ่าน</th><th>นำเข้า</th><th>เชื่อมกับคลิป/สินค้า</th></tr></thead>
        <tbody>{recent.map(b => <tr key={String(b.id)}><td>{new Date(String(b.imported_at)).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</td><td>{names.get(String(b.tiktok_account_id)) ?? "-"}</td>
          <td>{kindLabel[String(b.kind)] ?? String(b.kind)}</td><td>{String(b.file_name)}</td><td>{Number(b.rows_read).toLocaleString("th-TH")}</td>
          <td>{Number(b.rows_imported).toLocaleString("th-TH")}</td><td>{Number(b.rows_linked).toLocaleString("th-TH")}</td></tr>)}</tbody></table></div>
        : <p className="muted">ยังไม่เคยนำเข้ารายงาน</p>}
    </section>
  </>;
}
