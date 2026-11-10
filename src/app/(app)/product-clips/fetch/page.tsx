import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ExtensionCheck } from "./extension-check";
import "../product-clips.css";

export const metadata = { title: "ดึงข้อมูลสินค้า · Viral Flow AI" };
export const dynamic = "force-dynamic";

/**
 * Opened in the owner's own Chrome, by the Flow worker (?job=…&auto=1) for a Shopee link, or by the extension's
 * "⚡ ส่งเข้า ViralFlow" button (?manual=1). The ViralFlow extension does the rest on this page (see workers/flow-browser/extension.mjs).
 */
export default async function ProductFetchPage({ searchParams }: { searchParams: Promise<{ job?: string; auto?: string; manual?: string }> }) {
  const params = await searchParams;
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  const self = `/product-clips/fetch?${new URLSearchParams(Object.entries(params).filter(([, v]) => typeof v === "string") as [string, string][])}`;
  if (error || !data.user) redirect(`/login?next=${encodeURIComponent(self)}`);
  const jobId = z.uuid().safeParse(params.job).success ? params.job! : null;
  let link = "", title = "";
  if (jobId) {
    const row = await client.from("product_link_clips").select("link,status,script").eq("owner_id", data.user.id).eq("id", jobId).maybeSingle();
    const job = row.data as { link: string; status: string; script: { lookup?: unknown; shortName?: string } } | null;
    if (job && job.status === "PRODUCING" && job.script?.lookup) link = job.link;
    title = job?.script?.shortName ?? "";
  }
  return <main className="pl-fetch">
    <div id="vf-fetch" data-job={jobId ?? ""} data-link={link} data-auto={params.auto === "1" ? "1" : "0"} hidden />
    <h1>ดึงข้อมูลสินค้าจาก Chrome ของคุณ</h1>
    {title && <p>{title}</p>}
    <p id="vf-status" role="status">{jobId && !link ? "คลิปนี้ไม่ได้รอข้อมูลสินค้าแล้ว" : "กำลังเริ่ม…"}</p>
    {(link || !jobId) && <ExtensionCheck />}
    <p><Link href="/product-clips">กลับไปหน้าคลิปสินค้า</Link></p>
  </main>;
}
