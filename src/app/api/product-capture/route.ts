import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { detailsFromBrowser, lookupErrorLabel } from "@/features/product-links/browser-lookup";
import { capturePlatform, captureSchema, escapeHtml, marketplaceOrigin, type ProductCapture } from "@/features/product-links/capture";
import { captureProductPage, imageType } from "@/features/product-links/service";

/**
 * The "ส่งเข้า ViralFlow" bookmark posts the open Shopee/Lazada page here in two steps:
 * 1. From the shop's page (a cross-site post, so no ViralFlow sign-in cookie comes with it): only a Shopee or Lazada
 *    origin is accepted, and the reply is a ViralFlow page that shows what was read and sends it on by itself.
 * 2. From that ViralFlow page (same site, so the owner's sign-in comes with it): the clip waiting for the product is filled.
 */
export const maxDuration = 120;
const HOME = "/product-clips";
const MAX_BODY = 4_400_000;

function page(title: string, body: string, status = 200) {
  return new NextResponse(`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#0f1115;color:#f3f4f6}
main{max-width:560px;margin:0 auto}h1{font-size:20px}img{width:96px;height:96px;object-fit:cover;border-radius:10px;margin:0 8px 8px 0}
button{font:inherit;font-weight:700;padding:14px 22px;border:0;border-radius:12px;background:#ff3b6b;color:#fff;cursor:pointer}a{color:#9ec5ff}</style></head>
<body><main>${body}</main></body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
const fail = (message: string, status = 400) => page("ส่งเข้า ViralFlow ไม่สำเร็จ", `<h1>ส่งไม่สำเร็จ</h1><p>${escapeHtml(message)}</p><p><a href="${HOME}">กลับไปหน้าคลิปสินค้า</a></p>`, status);
const back = (request: NextRequest, message: string) => NextResponse.redirect(new URL(`${HOME}?msg=${encodeURIComponent(message)}`, request.url), 303);

async function readCapture(form: FormData): Promise<{ capture: ProductCapture; raw: string } | null> {
  const raw = form.get("data");
  if (typeof raw !== "string" || raw.length > MAX_BODY) return null;
  try {
    const parsed = captureSchema.safeParse(JSON.parse(raw));
    return parsed.success ? { capture: parsed.data, raw } : null;
  } catch { return null; }
}
const photoSrc = (base64: string) => {
  try {
    const type = imageType(new Uint8Array(Buffer.from(base64.slice(0, 64), "base64")));
    return type ? `data:image/${type === "jpg" ? "jpeg" : type};base64,${base64}` : null;
  } catch { return null; }
};

export async function POST(request: NextRequest) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return fail("ข้อมูลใหญ่เกินไป", 413);
  let form: FormData;
  try { form = await request.formData(); } catch { return fail("อ่านข้อมูลที่ส่งมาไม่ได้"); }
  const read = await readCapture(form);
  if (!read) return fail("ข้อมูลหน้าสินค้าไม่ครบ ลองเปิดหน้าสินค้าใหม่แล้วกดปุ่มอีกครั้ง");
  const platform = capturePlatform(read.capture.finalUrl);
  if (!platform) return fail("กดปุ่มนี้บนหน้าสินค้า Shopee หรือ Lazada เท่านั้น");
  const origin = request.headers.get("origin");

  if (form.get("step") !== "confirm") {
    if (!marketplaceOrigin(origin)) return fail("กดปุ่มนี้บนหน้าสินค้า Shopee หรือ Lazada เท่านั้น", 403);
    const details = detailsFromBrowser(platform, { ...read.capture, jobId: "00000000-0000-4000-8000-000000000000", ok: true });
    const photos = (read.capture.images ?? []).map(p => photoSrc(p.base64)).filter((s): s is string => !!s);
    const body = `<h1>${escapeHtml(details.title || "สินค้าจากหน้าร้าน")}</h1>
<p>${photos.length ? photos.map(src => `<img alt="" src="${escapeHtml(src)}">`).join("") : `รูป ${details.imageUrls.length} รูป`}</p>
<form id="send" method="post" action="/api/product-capture" enctype="multipart/form-data">
<input type="hidden" name="step" value="confirm"><textarea name="data" hidden>${escapeHtml(read.raw)}</textarea>
<button type="submit">ส่งเข้า ViralFlow</button></form><p id="wait">กำลังส่งเข้า ViralFlow…</p>
<script>document.getElementById("send").requestSubmit()</script>`;
    return page("ส่งเข้า ViralFlow", body);
  }

  // Step 2: only from ViralFlow's own page.
  if (origin !== new URL(request.url).origin) return fail("ส่งได้จากหน้า ViralFlow เท่านั้น", 403);
  const { data, error } = await (await createClient()).auth.getUser();
  if (error || !data.user) return NextResponse.redirect(new URL(`/login?next=${HOME}`, request.url), 303);
  try { await enforceOwnerMutationRateLimit("product-capture", data.user.id); } catch { return fail("ส่งถี่เกินไป รอสักครู่แล้วลองใหม่", 429); }
  try {
    const result = await captureProductPage(createAdminClient(), data.user.id, read.capture, platform);
    if (result.status === "QUEUED") return back(request, `ได้ข้อมูลสินค้าแล้ว: ${result.title} · เข้าคิว ${result.shots} ช็อต${result.created ? " (คลิปใหม่ 16 วิ)" : ""} เครื่องสร้างคลิปจะทำต่อเอง`);
    if (result.status === "IGNORED") return back(request, "คลิปนี้ไม่ได้รอข้อมูลสินค้าแล้ว");
    return back(request, "ดึงข้อมูลจากหน้านี้ไม่ครบ (ไม่มีชื่อหรือรูปสินค้า) ลองเลื่อนดูรูปสินค้าให้โหลดก่อน แล้วกดปุ่มอีกครั้ง");
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "";
    if (code === "account_not_found") return back(request, "ยังไม่มีบัญชี TikTok ในระบบ เพิ่มบัญชีก่อนแล้วกดปุ่มอีกครั้ง");
    return back(request, `ส่งข้อมูลสินค้าไม่สำเร็จ: ${lookupErrorLabel(code) ?? "ลองใหม่อีกครั้ง"}`);
  }
}
