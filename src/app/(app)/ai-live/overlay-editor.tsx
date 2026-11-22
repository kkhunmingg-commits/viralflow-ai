"use client";

/* The preview background is the PC's live stream or a base64 JPEG, not a file Next can optimise. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FACE_ID, OverlayStage } from "@/features/live-overlay/stage";
import {
  MAX_ITEMS, PROMO_TEMPLATES, TEXT_STYLES, makeItem, newId, pickSpot,
  type OverlayConfig, type OverlayItem, type OverlayKind, type OverlayProduct, type PromoTemplate,
} from "@/features/live-overlay/model";
import { LAYOUTS, TONES, autoPromoSet, lookLabel, productCategory } from "@/features/live-overlay/themes";

const LOCAL_STREAM = "http://127.0.0.1:8776/stream.mjpg";
const EMOJI = ["❤️", "🔥", "😍", "🥰", "😂", "🤩", "😎", "👍", "👏", "🙏", "💯", "✨", "⭐", "🌟", "🎉", "🎊", "🎁", "💰", "💸", "🛒", "🛍️", "📦", "⚡", "💥", "💖", "💕", "😘", "😱", "🤑", "👑", "💎", "🌈", "🌸", "🍀", "🐱", "🐶", "🧧", "⏰", "📣", "🆕"];
const KIND_LABEL: Record<OverlayKind, string> = { text: "ข้อความ", clock: "นาฬิกา", emoji: "อีโมจิ", image: "รูปภาพ", promo: "ป้ายโปร" };
const STYLE_LABEL: Record<typeof TEXT_STYLES[number], string> = { "red-tag": "ป้ายแดง", "white-outline": "ขาวขอบดำ", "yellow-pop": "เหลืองเด่น", gradient: "ไล่สีชมพูส้ม", "dark-pill": "แถบดำใส", "gold-lux": "ทองหรู", neon: "นีออน", "mint-pill": "มินต์" };
const TEMPLATE_LABEL: Record<PromoTemplate, string> = { banner: "แบนเนอร์สินค้า", "price-tag": "ป้ายราคา", card: "การ์ดสินค้า", ticker: "แถบตัววิ่ง", frame: "กรอบไลฟ์ทั้งจอ" };
const COLORS = [["red", "แดง"], ["orange", "ส้ม"], ["pink", "ชมพู"], ["purple", "ม่วง"], ["green", "เขียว"], ["blue", "ฟ้า"], ["gold", "ทอง"], ["black", "ดำ"], ["mint", "มินต์"]] as const;

type Loaded = { config: OverlayConfig; obsUrl: string; products: OverlayProduct[] };
const describe = (item: OverlayItem) => item.kind === "text" ? item.text || "ข้อความ"
  : item.kind === "emoji" ? item.emoji : item.kind === "promo" ? TEMPLATE_LABEL[item.template] + (item.product ? ` · ${item.product}` : "")
    : KIND_LABEL[item.kind];

/** Downscales a picture to at most 1024 px and keeps transparency (PNG), so a phone photo uploads fast. */
async function toPng(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return await new Promise((ok, bad) => canvas.toBlob(b => b ? ok(b) : bad(new Error("encode")), "image/png"));
}

export function OverlayEditor() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<OverlayConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [poke, setPoke] = useState<{ id: string; x: number; y: number } | null>(null);
  const [emojiPop, setEmojiPop] = useState(true);
  const [template, setTemplate] = useState<PromoTemplate>("banner");
  const [uploading, setUploading] = useState(false);
  const [bg, setBg] = useState<{ stream: "trying" | "ok" | "failed"; snapshot: string | null }>({ stream: "trying", snapshot: null });

  const say = (text: string) => { setToast(text); setTimeout(() => setToast(null), 3500); };
  useEffect(() => {
    fetch("/api/live-overlay", { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(); return r.json() as Promise<Loaded>; })
      .then(data => { setLoaded(data); setConfig(data.config); setDirty(false); setError(null); })
      .catch(() => setError("โหลดการตั้งค่าโอเวอร์เลย์ไม่ได้ ลองรีเฟรชหน้า"));
    fetch("/api/praew-live", { cache: "no-store" }).then(r => r.ok ? r.json() : null)
      .then((s: { snapshot?: { jpeg: string } | null } | null) => { if (s?.snapshot?.jpeg) setBg(b => ({ ...b, snapshot: s.snapshot!.jpeg })); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const products = useMemo(() => loaded?.products ?? [], [loaded]);
  const category = useMemo(() => productCategory(products), [products]);
  const imageSrc = useCallback((ref: string) => ref.startsWith("https://") ? ref : `/api/live-overlay/img?ref=${encodeURIComponent(ref)}`, []);

  if (error && !config) return <p className="praew-empty">{error}</p>;
  if (!config || !loaded) return <p className="praew-note">กำลังโหลดโอเวอร์เลย์…</p>;

  const change = (next: OverlayConfig) => { setConfig(next); setDirty(true); };
  const items = config.items;
  const item = items.find(i => i.id === selected) ?? null;
  const patch = (id: string, values: Partial<OverlayItem>) => change({ ...config, items: items.map(i => i.id === id ? { ...i, ...values } as OverlayItem : i) });
  const add = (kind: OverlayKind, extra: Record<string, unknown> = {}) => {
    if (items.length >= MAX_ITEMS) { say(`ใส่ได้สูงสุด ${MAX_ITEMS} ชิ้น`); return null; }
    const fresh = makeItem(kind, extra);
    change({ ...config, items: [...items, fresh] }); setSelected(fresh.id);
    return fresh;
  };
  const remove = (id: string) => { change({ ...config, items: items.filter(i => i.id !== id) }); setSelected(null); };
  const duplicate = (src: OverlayItem) => {
    if (items.length >= MAX_ITEMS) return;
    const copy = { ...src, id: newId(src.kind), x: Math.min(1 - src.w, src.x + 0.03), y: Math.min(1 - src.h, src.y + 0.03), auto: undefined } as OverlayItem;
    change({ ...config, items: [...items, copy] }); setSelected(copy.id);
  };
  const layer = (id: string, dir: -1 | 1) => {
    const i = items.findIndex(x => x.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    const next = [...items]; [next[i], next[j]] = [next[j], next[i]];
    change({ ...config, items: next });
  };
  const onMove = (id: string, box: { x: number; y: number; w: number; h: number }) => {
    if (id === FACE_ID) change({ ...config, faceZone: box }); else patch(id, box);
  };

  const save = async (rotate = false) => {
    setSaving(true);
    try {
      const r = await fetch("/api/live-overlay", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ config, rotate }) });
      if (!r.ok) throw new Error();
      const done = await r.json() as { obsUrl: string };
      setLoaded({ ...loaded, config, obsUrl: done.obsUrl }); setDirty(false);
      say(rotate ? "สร้างลิงก์ใหม่แล้ว ลิงก์เก่าใช้ไม่ได้แล้ว อย่าลืมเปลี่ยนใน OBS" : "บันทึกแล้ว จอไลฟ์ใน OBS จะเปลี่ยนภายใน 5 วินาที");
    } catch { say("บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง"); } finally { setSaving(false); }
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const png = await toPng(file);
      const r = await fetch("/api/live-overlay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "image/png" }) });
      if (!r.ok) throw new Error();
      const ticket = await r.json() as { path: string; token: string };
      const sent = await createClient().storage.from("video-assets").uploadToSignedUrl(ticket.path, ticket.token, png, { contentType: "image/png" });
      if (sent.error) throw sent.error;
      add("image", { src: ticket.path });
      say("เพิ่มรูปแล้ว ลากวางตำแหน่งได้เลย");
    } catch { say("อัปโหลดรูปไม่สำเร็จ (ใช้รูป PNG หรือ JPG)"); } finally { setUploading(false); }
  };
  const makeSet = (prefs: { tone?: string; layout?: string } = {}) => {
    const next = autoPromoSet(config, products, Math.random, prefs);
    change(next); setSelected(null);
    const name = lookLabel(next.look.last);
    say(products.length ? `สร้างชุด “${name}” จากสินค้า ${products.length} ตัวแล้ว กดบันทึกเพื่อขึ้นไลฟ์` : `สร้างชุด “${name}” แล้ว (ยังไม่มีสินค้า ป้ายจะเปลี่ยนเองเมื่อมีสินค้า)`);
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(loaded.obsUrl); say("คัดลอกลิงก์สำหรับ OBS แล้ว"); } catch { say("คัดลอกไม่ได้ กดค้างที่ลิงก์แล้วคัดลอกเอง"); }
  };

  const num = (label: string, key: "x" | "y" | "w" | "h" | "opacity" | "rotation" | "everyMin" | "showSec", step: number, min: number, max: number, hint?: string) =>
    item ? <label className="lo-field"><span>{label}</span>
      <input type="number" step={step} min={min} max={max} value={item[key]}
        onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) patch(item.id, { [key]: Math.min(max, Math.max(min, v)) }); }} />
      {hint ? <small>{hint}</small> : null}</label> : null;

  return <div className="lo-editor">
    <div className="lo-editor-preview">
      <div className="lo-preview-frame">
        {bg.snapshot ? <img className="lo-bg" src={`data:image/jpeg;base64,${bg.snapshot}`} alt="" /> : <div className="lo-bg lo-bg-empty"><span>แพรว</span></div>}
        {bg.stream !== "failed" ? <img className={`lo-bg lo-bg-stream${bg.stream === "ok" ? " on" : ""}`} src={LOCAL_STREAM} alt=""
          onLoad={() => setBg(b => ({ ...b, stream: "ok" }))} onError={() => setBg(b => ({ ...b, stream: "failed" }))} /> : null}
        <OverlayStage mode="edit" config={config} products={products} imageSrc={imageSrc} selected={selected} onSelect={setSelected} onMove={onMove} poke={poke} />
      </div>
      <p className="praew-note">ลากเพื่อย้าย ลากจุดฟ้ามุมขวาล่างเพื่อปรับขนาด · กรอบแดงประ = พื้นที่หน้าแพรว (ลากปรับได้)</p>
      <label className="lo-check"><input type="checkbox" checked={config.enabled} onChange={e => change({ ...config, enabled: e.target.checked })} /> แสดงโอเวอร์เลย์บนไลฟ์</label>
    </div>

    <div className="lo-editor-side">
      <div className="lo-tools">
        <button type="button" onClick={() => add("text")}>T เพิ่มข้อความ</button>
        <button type="button" onClick={() => add("clock")}>🕒 เพิ่มนาฬิกา</button>
        <label className={`lo-upload${uploading ? " busy" : ""}`}>🖼 {uploading ? "กำลังอัปโหลด…" : "เพิ่มรูปภาพ"}
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }} /></label>
        <span className="lo-promo-add">
          <select value={template} onChange={e => setTemplate(e.target.value as PromoTemplate)} aria-label="แบบป้ายโปร">
            {PROMO_TEMPLATES.map(t => <option key={t} value={t}>{TEMPLATE_LABEL[t]}</option>)}
          </select>
          <button type="button" onClick={() => add("promo", { template })}>➕ ป้ายโปร</button>
        </span>
      </div>
      <div className="lo-theme">
        <div className="lo-theme-pick">
          <label className="lo-field"><span>โทนสี</span>
            <select value={config.look.tone} onChange={e => change({ ...config, look: { ...config.look, tone: e.target.value } })}>
              <option value="auto">ตามสินค้า ({category.label})</option>
              {TONES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select></label>
          <label className="lo-field"><span>รูปแบบจอ</span>
            <select value={config.look.layout} onChange={e => change({ ...config, look: { ...config.look, layout: e.target.value } })}>
              <option value="random">สุ่มรูปแบบ</option>
              {LAYOUTS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select></label>
        </div>
        <div className="lo-theme-go">
          <button type="button" className="praew-btn go lo-auto" disabled={!products.length && items.some(i => i.auto)} onClick={() => makeSet()}>
            ✨ สร้างชุดหน้าจอไลฟ์จากสินค้าที่แพรวพูดถึง
          </button>
          <button type="button" className="lo-shuffle" onClick={() => makeSet({ tone: "auto", layout: "random" })} title="สุ่มโทนและรูปแบบใหม่ ไม่ซ้ำแบบเดิม">🎲 สุ่มแบบใหม่</button>
        </div>
        <label className="lo-check"><input type="checkbox" checked={config.look.autoNew} onChange={e => change({ ...config, look: { ...config.look, autoNew: e.target.checked } })} /> เปิดไลฟ์ครั้งใหม่ ให้สุ่มแบบใหม่เองอัตโนมัติ (ไม่ซ้ำครั้งก่อน)</label>
        <p className="praew-note">{config.look.last ? `ตอนนี้: ${lookLabel(config.look.last)} · ` : ""}โทนสีเลือกตามประเภทสินค้า ใช้ชื่อ ราคา ข้อมูล และรูปสินค้าที่มีอยู่แล้ว ทำในเว็บเอง ฟรี · กดซ้ำได้ จะแทนชุดเดิมแต่ไม่ลบชิ้นที่เพิ่มเอง</p>
      </div>

      <details className="lo-emoji-box">
        <summary>😀 เพิ่มอีโมจิ</summary>
        <label className="lo-check"><input type="checkbox" checked={emojiPop} onChange={e => setEmojiPop(e.target.checked)} /> ให้สุ่มเด้ง (ทุก ~3 นาที นาน 5 วิ ที่ตำแหน่งสุ่ม ไม่ทับหน้าแพรว)</label>
        <div className="lo-emoji-grid">
          {EMOJI.map(e => <button key={e} type="button" onClick={() => add("emoji", emojiPop ? { emoji: e, everyMin: 3, showSec: 5, randomPos: true } : { emoji: e })}>{e}</button>)}
        </div>
      </details>

      {item ? <div className="lo-props">
        <div className="lo-props-head"><b>{KIND_LABEL[item.kind]}</b>
          <span>
            {item.everyMin > 0 ? <button type="button" onClick={() => {
              setPoke({ id: item.id, ...(item.randomPos ? pickSpot(item.w, item.h, config.faceZone) : { x: item.x, y: item.y }) });
              setTimeout(() => setPoke(p => p?.id === item.id ? null : p), Math.min(item.showSec, 8) * 1000);
            }}>🎉 ลองเด้ง</button> : null}
            <button type="button" onClick={() => layer(item.id, 1)} title="ไว้ข้างหน้า">⬆</button>
            <button type="button" onClick={() => layer(item.id, -1)} title="ไว้ข้างหลัง">⬇</button>
            <button type="button" onClick={() => duplicate(item)}>ทำซ้ำ</button>
            <button type="button" className="danger" onClick={() => remove(item.id)}>ลบ</button>
          </span>
        </div>
        {item.kind === "text" ? <>
          <label className="lo-field wide"><span>ข้อความ</span><input value={item.text} maxLength={200} onChange={e => patch(item.id, { text: e.target.value })} /></label>
        </> : null}
        {item.kind === "text" || item.kind === "clock" ? <label className="lo-field"><span>แบบตัวอักษร</span>
          <select value={item.style} onChange={e => patch(item.id, { style: e.target.value as typeof TEXT_STYLES[number] })}>
            {TEXT_STYLES.map(s => <option key={s} value={s}>{STYLE_LABEL[s]}</option>)}</select></label> : null}
        {item.kind === "clock" ? <label className="lo-check"><input type="checkbox" checked={item.withDate} onChange={e => patch(item.id, { withDate: e.target.checked })} /> แสดงวันที่ด้วย</label> : null}
        {item.kind === "emoji" ? <label className="lo-field"><span>อีโมจิ</span><input value={item.emoji} maxLength={16} onChange={e => e.target.value && patch(item.id, { emoji: e.target.value })} /></label> : null}
        {item.kind === "image" && products.some(p => p.image) ? <label className="lo-field wide"><span>หรือใช้รูปสินค้า</span>
          <select value={products.find(p => p.image === item.src)?.name ?? ""} onChange={e => { const p = products.find(x => x.name === e.target.value); if (p?.image) patch(item.id, { src: p.image }); }}>
            <option value="">— รูปที่อัปโหลด —</option>
            {products.filter(p => p.image).map(p => <option key={p.name} value={p.name}>{p.name}</option>)}</select></label> : null}
        {item.kind === "promo" ? <>
          <label className="lo-field"><span>แบบป้าย</span><select value={item.template} onChange={e => patch(item.id, { template: e.target.value as PromoTemplate })}>
            {PROMO_TEMPLATES.map(t => <option key={t} value={t}>{TEMPLATE_LABEL[t]}</option>)}</select></label>
          <label className="lo-field"><span>สี</span><select value={item.color} onChange={e => patch(item.id, { color: e.target.value as typeof item.color })}>
            {COLORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          {item.template !== "ticker" ? <label className="lo-field wide"><span>สินค้า</span><select value={item.product} onChange={e => patch(item.id, { product: e.target.value })}>
            <option value="">วนสินค้าที่แพรวพูดถึงทุกตัว</option>
            {products.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
            {item.product && !products.some(p => p.name === item.product) ? <option value={item.product}>{item.product} (ไม่อยู่ในรายการแล้ว)</option> : null}
          </select></label> : null}
          {!item.product && item.template !== "ticker" ? <label className="lo-field"><span>เปลี่ยนสินค้าทุก (วินาที)</span>
            <input type="number" min={3} max={600} value={item.cycleSec} onChange={e => patch(item.id, { cycleSec: Math.min(600, Math.max(3, Number(e.target.value) || 12)) })} /></label> : null}
          <label className="lo-field wide"><span>{item.template === "ticker" ? "ข้อความวิ่ง (ว่าง = ชื่อและข้อมูลสินค้า)" : item.template === "frame" ? "หัวกรอบ (ว่าง = 🔥 LIVE สด ช้อปในไลฟ์ 🔥)" : "หัวข้อ (ว่าง = ชื่อสินค้า)"}</span>
            <input value={item.title} maxLength={120} onChange={e => patch(item.id, { title: e.target.value })} /></label>
          {item.template !== "ticker" ? <>
            <label className="lo-field"><span>ราคา/โปร (ว่าง = ราคาที่รู้)</span><input value={item.price} maxLength={40} placeholder="เช่น ฿199 หรือ ลด 50%" onChange={e => patch(item.id, { price: e.target.value })} /></label>
            <label className="lo-field"><span>ป้ายเล็ก</span><input value={item.badge} maxLength={40} placeholder="โปรในไลฟ์" onChange={e => patch(item.id, { badge: e.target.value })} /></label>
            <label className="lo-field wide"><span>ปุ่มชวนซื้อ</span><input value={item.cta} maxLength={60} placeholder="กดตะกร้าสีส้มได้เลย 🛒" onChange={e => patch(item.id, { cta: e.target.value })} /></label>
          </> : null}
        </> : null}
        <div className="lo-grid">
          {num("X", "x", 0.01, 0, 1)}{num("Y", "y", 0.01, 0, 1)}
          {num("ความกว้าง", "w", 0.01, 0.02, 1)}{num("ความสูง", "h", 0.01, 0.01, 1)}
          {num("ความทึบ", "opacity", 0.05, 0, 1, "1 = ทึบ, 0 = มองไม่เห็น")}{num("มุมหมุน (องศา)", "rotation", 1, -180, 180)}
          {num("สุ่มโผล่ประมาณทุก (นาที)", "everyMin", 0.5, 0, 120, "0 = แสดงตลอด")}
          {item.everyMin > 0 ? num("โผล่นาน (วินาที)", "showSec", 1, 1, 600) : null}
        </div>
        {item.everyMin > 0 ? <label className="lo-check"><input type="checkbox" checked={item.randomPos} onChange={e => patch(item.id, { randomPos: e.target.checked })} /> สุ่มตำแหน่งทุกครั้งที่โผล่ (ไม่ทับหน้าแพรว ไม่บังกลางจอ)</label> : null}
        <label className="lo-check"><input type="checkbox" checked={item.hidden} onChange={e => patch(item.id, { hidden: e.target.checked })} /> ซ่อนชิ้นนี้ไว้ก่อน</label>
      </div> : selected === FACE_ID ? <div className="lo-props"><b>พื้นที่หน้าแพรว</b><p className="praew-note">ลากกรอบให้ครอบหน้าแพรว ของที่ตั้งให้สุ่มเด้งจะไม่โผล่ทับตรงนี้</p></div>
        : <p className="praew-note">กดชิ้นบนภาพหรือในรายการด้านล่างเพื่อแก้ไข</p>}

      <ol className="lo-layers">
        {items.slice().reverse().map(i => <li key={i.id} className={i.id === selected ? "on" : ""}>
          <button type="button" onClick={() => setSelected(i.id)}><span>{KIND_LABEL[i.kind]}</span>{describe(i)}{i.everyMin > 0 ? <em>เด้ง</em> : null}{i.hidden ? <em>ซ่อน</em> : null}{i.auto ? <em>อัตโนมัติ</em> : null}</button>
        </li>)}
        {!items.length ? <li className="lo-layers-empty">ยังไม่มีชิ้นไหน ลองกด “สร้างชุดหน้าจอไลฟ์”</li> : null}
      </ol>

      <details className="lo-obs">
        <summary>ตั้ง OBS ครั้งแรก (ทำครั้งเดียว)</summary>
        <ol>
          <li>ใน OBS ซีน <b>Praew</b> กด + → <b>Browser</b> (เบราว์เซอร์) ตั้งชื่อ “โอเวอร์เลย์โปร”</li>
          <li>วางลิงก์ด้านล่างในช่อง URL · กว้าง <b>720</b> สูง <b>1280</b> · FPS ตั้ง 20 ก็พอ</li>
          <li>ให้ “โอเวอร์เลย์โปร” อยู่<b>เหนือ</b> “แพรว (ภาพสด)” แล้วกดบันทึกที่หน้านี้ จอใน OBS จะเปลี่ยนตามเองภายใน 5 วินาที</li>
        </ol>
        <div className="lo-link"><input readOnly value={loaded.obsUrl} onFocus={e => e.target.select()} aria-label="ลิงก์โอเวอร์เลย์สำหรับ OBS" />
          <button type="button" onClick={copyLink}>คัดลอก</button></div>
        <button type="button" className="lo-rotate" disabled={saving} onClick={() => void save(true)}>สร้างลิงก์ใหม่ (ถ้าลิงก์หลุดไปให้คนอื่น)</button>
      </details>
    </div>

    <div className={`lo-savebar${dirty ? " dirty" : ""}`}>
      <span>{dirty ? "มีการแก้ที่ยังไม่บันทึก" : "บันทึกแล้ว · ตรงกับจอใน OBS"}</span>
      {dirty ? <button type="button" className="lo-undo" disabled={saving} onClick={() => { setConfig(loaded.config); setDirty(false); setSelected(null); }}>ยกเลิกที่แก้</button> : null}
      <button type="button" className="praew-btn go small" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "กำลังบันทึก…" : "บันทึกการเปลี่ยนแปลง"}</button>
    </div>
    {toast ? <p className="praew-toast" role="status">{toast}</p> : null}
  </div>;
}
