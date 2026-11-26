import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ClipStudioTabs } from "@/components/clip-studio-tabs";
import { listTikTokProducts, type TikTokShopProduct } from "@/features/tiktok-shop/catalog";
import { fmtCount } from "@/features/tiktok-shop/items";
import { pickTikTokProductsAction, setLiveAction } from "./actions";
import "../../post/post.css";
import "../../post/flow-studio.css";
import "../product-clips.css";

export const metadata = { title: "สินค้าขายดี TikTok · Viral Flow AI" };
export const dynamic = "force-dynamic";

/** TikTok Shop Thailand's own pages the extension reads: the home page and every category (each lists its best-sellers). */
const CATEGORIES: Array<[string, string]> = [
  ["womenswear-underwear/601152", "เสื้อผ้าผู้หญิง"], ["phones-electronics/601739", "มือถือ/อิเล็กทรอนิกส์"], ["fashion-accessories/605248", "เครื่องประดับแฟชั่น"],
  ["menswear-underwear/824328", "เสื้อผ้าผู้ชาย"], ["home-supplies/600001", "ของใช้ในบ้าน"], ["beauty-personal-care/601450", "ความงาม"], ["shoes/601352", "รองเท้า"],
  ["sports-outdoor/603014", "กีฬา/กลางแจ้ง"], ["luggage-bags/824584", "กระเป๋า"], ["toys-hobbies/604206", "ของเล่น"], ["automotive-motorcycle/605196", "ยานยนต์"],
  ["kids-fashion/802184", "เสื้อผ้าเด็ก"], ["kitchenware/600024", "เครื่องครัว"], ["computers-office-equipment/601755", "คอม/สำนักงาน"], ["baby-maternity/602284", "แม่และเด็ก"],
  ["tools-hardware/604579", "เครื่องมือช่าง"], ["textiles-soft-furnishings/600154", "เครื่องนอน/ผ้า"], ["pet-supplies/602118", "สัตว์เลี้ยง"], ["home-improvement/604968", "ปรับปรุงบ้าน"],
  ["food-beverages/700437", "อาหาร/เครื่องดื่ม"], ["household-appliances/600942", "เครื่องใช้ไฟฟ้า"], ["health/700645", "สุขภาพ"], ["furniture/604453", "เฟอร์นิเจอร์"],
];
const CATEGORY_TH = new Map(CATEGORIES.map(([path, th]) => [path.split("/")[0], th]));
const PULL_URLS = ["https://shop.tiktok.com/th", ...CATEGORIES.map(([path]) => `https://shop.tiktok.com/th/c/${path}`)];
const LENGTHS = [8, 16, 24, 32, 40] as const;
const bangkokTime = (iso: string) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
const CLIP_STATUS: Record<string, string> = { PRODUCING: "กำลังทำคลิป", ASSEMBLING: "กำลังตัดต่อ", REVIEW: "คลิปรอตรวจ", APPROVED: "คลิปพร้อมโพสต์", PUBLISHING: "กำลังโพสต์",
  PUBLISHED: "โพสต์แล้ว", REJECTED: "คลิปไม่ผ่าน", FAILED: "ทำคลิปไม่สำเร็จ" };

/** The owner's showcase in LIVE Manager: every product there pays the owner a commission. */
const SHOWCASE_URL = "https://shop.tiktok.com/streamer/showcase/product/list?region=th";

export default async function TikTokShopPage({ searchParams }: { searchParams: Promise<{ msg?: string; cat?: string; q?: string; sort?: string; all?: string }> }) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login?next=/product-clips/tiktok");
  const owner = data.user.id, { msg, cat, q, sort: sortParam, all } = await searchParams;
  const sort = sortParam === "sold" ? "sold" : "commission";
  // 26 Nov (Lucky): only products that pay commission, i.e. the ones in the owner's showcase, unless asked for all.
  const commissionOnly = all !== "1";
  const [{ available, products }, accountsResult] = await Promise.all([
    listTikTokProducts(client, owner, 1000, { sort, commissionOnly }).catch(() => ({ available: false, products: [] as TikTokShopProduct[] })),
    client.from("tiktok_accounts").select("id,display_name,username,is_mock").eq("owner_id", owner).is("hidden_at", null).order("created_at", { ascending: true }),
  ]);
  const accounts = ((accountsResult.data ?? []) as Array<{ id: string; display_name: string; username: string | null; is_mock: boolean | null }>)
    .filter(a => process.env.NODE_ENV !== "production" || !a.is_mock);
  const clipIds = products.map(p => p.clip_id).filter((v): v is string => !!v);
  const clips = clipIds.length ? await client.from("product_link_clips").select("id,status").eq("owner_id", owner).in("id", clipIds) : { data: [] };
  const clipStatus = new Map(((clips.data ?? []) as Array<{ id: string; status: string }>).map(c => [c.id, c.status]));
  const live = (await listTikTokProducts(client, owner, 50, { sort }).catch(() => ({ products: [] as TikTokShopProduct[] }))).products.filter(p => p.live);
  const category = z.string().regex(/^[a-z0-9-]{2,60}$/).safeParse(cat).success ? cat! : "";
  const query = (q ?? "").trim().slice(0, 60).toLowerCase();
  const listed = products.filter(p => !p.live && (!category || p.category === category) && (!query || p.title.toLowerCase().includes(query))).slice(0, 120);
  const categories = [...new Set(products.map(p => p.category).filter((c): c is string => !!c))];
  const lastPull = products.reduce<string | null>((max, p) => (!max || p.seen_at > max ? p.seen_at : max), null);

  return <div className="manual-page">
    <ClipStudioTabs />
    <header className="manual-hero"><div><p className="manual-eyebrow">Viral Flow AI · TikTok Shop · คลิปออโต้ · ไลฟ์แพรว</p><h1>สินค้า TikTok (ได้ค่าคอม)</h1>
      <p>ดึงสินค้าขายดีจาก TikTok Shop พร้อมยอดขายจริง ติ๊กเลือกตัวที่อยากขาย ระบบทำคลิปให้เอง และใส่สินค้าชุดเดียวกันในไลฟ์แพรว ชื่อสินค้าตรงกับในตะกร้า TikTok พอปักตะกร้าตัวไหน แพรวก็พูดตัวนั้น
        (สินค้า Shopee/Lazada อยู่แท็บ <Link href="/product-clips">คลิปสินค้า Shopee/Lazada</Link> ใช้โพสต์ลิงก์เหมือนเดิม และไม่เข้าไลฟ์)</p></div></header>
    <ol className="manual-steps" aria-label="ขั้นตอน"><li><span>1</span>ดึงสินค้าขายดี</li><li><span>2</span>ติ๊กเลือก</li><li><span>3</span>ระบบทำคลิป + ใส่ในไลฟ์</li><li><span>4</span>เพิ่มเข้าโชว์เคส แล้วปักตะกร้าตอนไลฟ์</li></ol>
    {msg && <p className="library-message" role="status">{msg.slice(0, 400)}</p>}
    {!available && <p className="manual-warning">ฐานข้อมูลยังไม่มีตารางสินค้า TikTok (tiktok_shop_products)</p>}

    <section className="manual-panel" aria-labelledby="tt-pull">
      <div className="manual-section-head"><div><p className="manual-eyebrow">ขั้นที่ 1 · ฟรี ใช้ Chrome ของคุณ</p><h2 id="tt-pull">ดึงสินค้าขายดีจาก TikTok Shop</h2></div>
        {lastPull && <span className="manual-private">ดึงล่าสุด {bangkokTime(lastPull)} · {products.length} สินค้า</span>}</div>
      <div id="vf-tt" data-urls={JSON.stringify(PULL_URLS)} hidden />
      <div className="library-inline">
        <button id="vf-tt-showcase" className="manual-primary" type="button" data-url={SHOWCASE_URL} disabled>ดึงสินค้าในโชว์เคส (ได้ค่าคอมทุกตัว)</button>
        <button id="vf-tt-pull" className="manual-secondary" type="button" disabled>ดึงยอดขายจากหน้าร้าน TikTok Shop ({PULL_URLS.length} หน้า)</button>
        <a className="manual-secondary" href="https://shop.tiktok.com/th" target="_blank" rel="noreferrer noopener">เปิด TikTok Shop เอง ↗</a>
      </div>
      <p id="vf-tt-status" className="library-message" role="status" hidden />
      <p className="manual-muted">ปุ่มโชว์เคส: อ่านสินค้าทั้งหมดในโชว์เคสของบัญชีคุณจากหน้า LIVE Manager พร้อมค่าคอมต่อชิ้นและสต็อก (ต้องล็อกอิน TikTok ใน Chrome นี้) ทุกตัวในโชว์เคสได้ค่าคอม และเพิ่มเข้าตะกร้าไลฟ์ได้
        · ปุ่มยอดขาย: อ่านยอดขายจากหน้าร้าน TikTok Shop ทุกหมวด สินค้าตัวไหนอยู่ในโชว์เคสด้วยจะได้ยอดขายมาเรียงให้</p>
      <p className="manual-muted">ปุ่มนี้ใช้ส่วนขยาย ViralFlow ใน Chrome (ตัวเดียวกับที่ใช้ Shopee และโพสต์ออโต้ อัปเดตเองจากเครื่องสร้างคลิป) ถ้าปุ่มยังกดไม่ได้ แปลว่า Chrome นี้ยังไม่มีส่วนขยายเวอร์ชันใหม่ เปิดเครื่องสร้างคลิปไว้สักครู่แล้วรีเฟรช หรือโหลดส่วนขยายใหม่ที่ <Link href="/product-clips">แท็บ Shopee/Lazada</Link>
        · ระบบจะเปิดหน้า TikTok Shop ทีละหมวดในแท็บเบื้องหลัง อ่านรายการสินค้าพร้อมยอดขาย ราคา และคะแนน แล้วปิดแท็บเอง ไม่ต้องล็อกอิน และไม่แตะบัญชีของคุณ
        · หรือเปิดหน้า TikTok Shop หมวดไหนก็ได้ แล้วกดปุ่ม ⚡ ส่งสินค้าหน้านี้เข้า ViralFlow มุมขวาล่าง</p>
    </section>

    <section className="manual-panel" aria-labelledby="tt-live">
      <div className="manual-section-head"><div><p className="manual-eyebrow">ไลฟ์แพรวขายตัวเหล่านี้ · <Link href="/ai-live">ไปหน้า AI LIVE</Link></p><h2 id="tt-live">สินค้าในไลฟ์ ({live.length})</h2></div></div>
      {live.length ? <div className="pl-cards">{live.map(p => <article key={p.id} className="pl-row">
        <ProductLine p={p} clip={p.clip_id ? clipStatus.get(p.clip_id) : undefined} />
        <form action={setLiveAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="live" value="off" />
          <button className="library-link danger" type="submit">เอาออกจากไลฟ์</button></form>
      </article>)}</div> : <p className="manual-muted">ยังไม่มีสินค้า TikTok ในไลฟ์ ติ๊กเลือกจากรายการขายดีด้านล่าง</p>}
      <p className="manual-muted">เติมและปักตะกร้าให้เอง: เปิด <a href="https://shop.tiktok.com/streamer/live/product/dashboard?region=th" target="_blank" rel="noreferrer">LIVE Manager (TikTok Shop)</a> ใน Chrome ที่มีส่วนขยาย ViralFlow และล็อกอินบัญชีที่ไลฟ์ ทิ้งแท็บไว้ ระบบจะเพิ่มสินค้าเหล่านี้เข้าตะกร้าไลฟ์ให้เอง และตอนไลฟ์จะปักทีละตัว เปลี่ยนตัวทุก 3 นาที แพรวพูดตัวที่ปักอยู่ มุมล่างซ้ายของหน้านั้นมีปุ่มหยุดออโต้</p>
    </section>

    <section className="manual-panel" aria-labelledby="tt-best">
      <div className="manual-section-head"><div><p className="manual-eyebrow">ขั้นที่ 2–3 · {commissionOnly ? "เฉพาะสินค้าในโชว์เคส (ได้ค่าคอม มีของ)" : "ทุกสินค้า"} · เรียงตาม{sort === "commission" ? "ค่าคอม" : "ยอดขาย"}</p><h2 id="tt-best">เลือกสินค้า ({listed.length})</h2></div></div>
      <form className="library-start" method="get">
        <label className="manual-filter">เรียงตาม<select name="sort" defaultValue={sort}><option value="commission">ค่าคอมสูงสุด</option><option value="sold">ยอดขายสูงสุด</option></select></label>
        <label className="manual-check"><input type="checkbox" name="all" value="1" defaultChecked={!commissionOnly} /> แสดงตัวที่ไม่ได้ค่าคอมหรือของหมดด้วย</label>
        <label className="manual-filter">หมวด<select name="cat" defaultValue={category}><option value="">ทุกหมวด</option>
          {categories.map(c => <option key={c} value={c}>{CATEGORY_TH.get(c) ?? c}</option>)}</select></label>
        <label className="manual-filter">ค้นชื่อ<input name="q" defaultValue={q ?? ""} maxLength={60} /></label>
        <button className="manual-secondary" type="submit">กรอง</button>
      </form>
      {listed.length ? <form action={pickTikTokProductsAction}>
        <div className="pl-cards">{listed.map(p => <label key={p.id} className="pl-row tt-pick">
          <input type="checkbox" name="id" value={p.id} />
          <ProductLine p={p} clip={p.clip_id ? clipStatus.get(p.clip_id) : undefined} />
        </label>)}</div>
        <div className="library-start tt-submit">
          {accounts.length ? <label className="manual-filter">ทำคลิปด้วยบัญชี (คิว Google Flow ของบัญชีนี้)<select name="tiktokAccountId" defaultValue={accounts[0].id}>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.username ? `@${a.username}` : a.display_name}</option>)}</select></label>
            : <p className="manual-warning">ต้องมีบัญชี TikTok ในระบบก่อน <Link href="/accounts">เชื่อมบัญชี →</Link></p>}
          <label className="manual-filter">ความยาวคลิป<select name="lengthSeconds" defaultValue="16">{LENGTHS.map(l => <option key={l} value={l}>{l} วิ</option>)}</select></label>
          <label className="manual-check"><input type="checkbox" name="makeClips" defaultChecked /> ทำคลิปออโต้ให้ด้วย</label>
          <button className="manual-primary" type="submit" disabled={!accounts.length}>ทำคลิป + ใส่ในไลฟ์แพรว (เลือกได้ครั้งละ 20)</button>
        </div>
        <p className="manual-muted">คลิปพูดเฉพาะสิ่งที่อยู่ในชื่อสินค้าบน TikTok Shop ไม่พูดราคา ไม่อ้างเกินจริง และชวนกดตะกร้าสีส้ม เสร็จแล้วรอตรวจที่ <Link href="/product-clips">แท็บคลิปสินค้า</Link> ผ่านแล้วแชร์จากมือถือไปแอป TikTok แล้วปักตะกร้าตัวเดียวกัน</p>
      </form> : <p className="manual-muted">{products.length ? "ไม่มีสินค้าตามที่กรอง" : commissionOnly ? "ยังไม่มีสินค้าในโชว์เคส กดดึงสินค้าในโชว์เคสด้านบนก่อน" : "ยังไม่มีสินค้า กดดึงสินค้าด้านบนก่อน"}</p>}
    </section>
  </div>;
}

function ProductLine({ p, clip }: { p: TikTokShopProduct; clip?: string }) {
  return <div className="tt-product">
    {p.image_url && <img src={p.image_url} alt="" width={64} height={64} loading="lazy" referrerPolicy="no-referrer" />}
    <div><strong>{p.title}</strong>
      <p className="library-meta">{p.commission !== null && p.in_showcase ? <b>ค่าคอม ฿{p.commission.toLocaleString("th-TH")} · </b> : !p.in_showcase ? "ไม่อยู่ในโชว์เคส (ไม่ได้ค่าคอม) · " : ""}
        {p.sold_count !== null ? `ขายแล้ว ${fmtCount(p.sold_count)} ชิ้น` : "ยังไม่มียอดขาย"}{p.price !== null ? ` · ฿${p.price.toLocaleString("th-TH")}` : ""}{p.stock !== null ? ` · สต็อก ${fmtCount(p.stock)}` : ""}{p.rating ? ` · ★ ${p.rating} (${fmtCount(p.review_count)})` : ""}
        {p.shop_name ? ` · ร้าน ${p.shop_name}` : ""}{p.category ? ` · ${CATEGORY_TH.get(p.category) ?? p.category}` : ""}
        {clip ? ` · ${CLIP_STATUS[clip] ?? clip}` : ""} · <a href={p.product_url} target="_blank" rel="noreferrer noopener">ดูใน TikTok Shop ↗</a></p></div>
  </div>;
}
