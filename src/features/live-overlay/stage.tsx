"use client";

/* Overlay pictures are signed Storage redirects or listing photos, not files Next can optimise. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { TIKTOK_UI, nextPopupDelaySec, pickSpot, promoProduct, promoWords, tickerText, type OverlayConfig, type OverlayItem, type OverlayProduct, type Zone } from "./model";
import "./stage.css";

export const FACE_ID = "__face";
type Box = { x: number; y: number; w: number; h: number };
type Drag = { id: string; mode: "move" | "resize"; startX: number; startY: number; box: Box; rect: DOMRect };

/**
 * The 9:16 overlay as OBS shows it. In "live" mode (the OBS page) pop-up items come and go on their own timers;
 * in "edit" mode (AI LIVE page) everything is shown and can be dragged and resized.
 */
export function OverlayStage({ config, products, imageSrc, mode, selected, onSelect, onMove, poke }: {
  config: OverlayConfig; products: readonly OverlayProduct[]; imageSrc: (ref: string) => string; mode: "live" | "edit";
  selected?: string | null; onSelect?: (id: string | null) => void; onMove?: (id: string, box: Box) => void;
  /** Edit mode: a pop-up being tried now ("ลองเด้ง") and where it lands. */
  poke?: { id: string; x: number; y: number } | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // Pop-up items: where each one is showing right now (live mode), or the one being tried in edit mode.
  const [shown, setShown] = useState<Record<string, { x: number; y: number } | null>>({});
  const popKey = config.items.filter(i => i.everyMin > 0 && !i.hidden).map(i => `${i.id}:${i.everyMin}:${i.showSec}:${i.randomPos}:${i.w}:${i.h}`).join("|");
  const face = config.faceZone;
  const faceKey = `${face.x}:${face.y}:${face.w}:${face.h}`;
  useEffect(() => {
    if (mode !== "live") return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let alive = true;
    for (const item of config.items) {
      if (item.everyMin <= 0 || item.hidden) continue;
      const cycle = (first: boolean) => {
        timers.push(setTimeout(() => {
          if (!alive) return;
          setShown(s => ({ ...s, [item.id]: item.randomPos ? pickSpot(item.w, item.h, face) : { x: item.x, y: item.y } }));
          timers.push(setTimeout(() => { if (alive) { setShown(s => ({ ...s, [item.id]: null })); cycle(false); } }, item.showSec * 1000));
        }, nextPopupDelaySec(item.everyMin, first) * 1000));
      };
      cycle(true);
    }
    return () => { alive = false; timers.forEach(clearTimeout); };
    // Restart the timers only when a pop-up's own settings change, not on every save of an unrelated item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, popKey, faceKey]);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [live, setLive] = useState<{ id: string; box: Box } | null>(null);
  const begin = (e: ReactPointerEvent, id: string, mode: Drag["mode"], box: Box) => {
    if (!onMove || !stage.current) return;
    e.stopPropagation(); e.preventDefault();
    onSelect?.(id);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { id, mode, startX: e.clientX, startY: e.clientY, box, rect: stage.current.getBoundingClientRect() };
  };
  const moveTo = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.rect.width, dy = (e.clientY - d.startY) / d.rect.height;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const box = d.mode === "move"
      ? { ...d.box, x: clamp(d.box.x + dx, 0, 1 - d.box.w), y: clamp(d.box.y + dy, 0, 1 - d.box.h) }
      : { ...d.box, w: clamp(d.box.w + dx, 0.03, 1 - d.box.x), h: clamp(d.box.h + dy, 0.015, 1 - d.box.y) };
    const r = (v: number) => Math.round(v * 1000) / 1000;
    setLive({ id: d.id, box: { x: r(box.x), y: r(box.y), w: r(box.w), h: r(box.h) } });
  };
  const end = () => {
    if (drag.current && live && live.id === drag.current.id) onMove?.(live.id, live.box);
    drag.current = null; setLive(null);
  };

  const editing = mode === "edit";
  return <div ref={stage} className={`lo-stage${editing ? " lo-edit" : ""}`} onPointerMove={moveTo} onPointerUp={end} onPointerCancel={end}
    onPointerDown={() => editing && onSelect?.(null)}>
    {config.enabled || editing ? config.items.map(item => {
      if (item.hidden && !editing) return null;
      const pop = item.everyMin > 0;
      const spot = editing ? (poke?.id === item.id ? poke : null) : shown[item.id];
      if (!editing && pop && !spot) return null;
      const box = live?.id === item.id ? live.box : { x: item.x, y: item.y, w: item.w, h: item.h };
      const at = spot && (!editing || !live) ? { ...box, x: spot.x, y: spot.y } : box;
      const style: CSSProperties = { left: `${at.x * 100}%`, top: `${at.y * 100}%`, width: `${at.w * 100}%`, height: `${at.h * 100}%`,
        opacity: item.hidden ? 0.25 : item.opacity, transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined };
      const cls = ["lo-item", `lo-k-${item.kind}`, pop && spot ? "lo-pop" : "", editing && pop && !spot ? "lo-waiting" : "", selected === item.id ? "lo-selected" : ""].join(" ");
      return <div key={item.id + (spot ? `@${spot.x}` : "")} className={cls} style={style}
        onPointerDown={editing ? e => begin(e, item.id, "move", box) : undefined}>
        <ItemBody item={item} products={products} now={now} imageSrc={imageSrc} />
        {editing && pop ? <span className="lo-pop-tag">เด้งทุก ~{item.everyMin} นาที</span> : null}
        {editing && selected === item.id ? <span className="lo-handle" onPointerDown={e => begin(e, item.id, "resize", box)} /> : null}
      </div>;
    }) : null}
    {editing ? TIKTOK_UI.map(z => <div key={z.label} className="lo-tiktok-ui" aria-hidden
      style={{ left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%` }}><span>{z.label} · อย่าวางทับ</span></div>) : null}
    {editing ? <FaceZone zone={live?.id === FACE_ID ? live.box : face} selected={selected === FACE_ID}
      onDown={(e, m) => begin(e, FACE_ID, m, face)} /> : null}
  </div>;
}

function FaceZone({ zone, selected, onDown }: { zone: Zone; selected: boolean; onDown: (e: ReactPointerEvent, mode: Drag["mode"]) => void }) {
  return <div className={`lo-face${selected ? " lo-selected" : ""}`} onPointerDown={e => onDown(e, "move")}
    style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `${zone.w * 100}%`, height: `${zone.h * 100}%` }}>
    <span>พื้นที่หน้าแพรว · ของที่สุ่มเด้งจะไม่ทับตรงนี้</span>
    {selected ? <span className="lo-handle" onPointerDown={e => onDown(e, "resize")} /> : null}
  </div>;
}

const fit = (text: string, k = 1.85) => `min(62cqh, ${Math.max(4, Math.round((k * 100) / Math.max(text.length, 3)))}cqw)`;
const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function ItemBody({ item, products, now, imageSrc }: { item: OverlayItem; products: readonly OverlayProduct[]; now: number; imageSrc: (ref: string) => string }) {
  switch (item.kind) {
    case "text":
      return <div className={`lo-text lo-s-${item.style}`} style={{ fontSize: fit(item.text || " ") }}>{item.text}</div>;
    case "clock": {
      const d = new Date(now), p = (n: number) => String(n).padStart(2, "0");
      const t = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      const label = item.withDate ? `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} · ${t}` : t;
      return <div className={`lo-text lo-clock lo-s-${item.style}`} style={{ fontSize: fit(label, 1.65) }}>{label}</div>;
    }
    case "emoji":
      return <div className="lo-emoji">{item.emoji}</div>;
    case "image":
      return item.src ? <img className="lo-img" src={imageSrc(item.src)} alt="" draggable={false} /> : <div className="lo-img-empty">ยังไม่ได้เลือกรูป</div>;
    case "promo":
      return <Promo item={item} products={products} now={now} imageSrc={imageSrc} />;
  }
}

function Promo({ item, products, now, imageSrc }: { item: Extract<OverlayItem, { kind: "promo" }>; products: readonly OverlayProduct[]; now: number; imageSrc: (ref: string) => string }) {
  const cls = `lo-promo lo-c-${item.color}`;
  if (item.template === "ticker") {
    const text = tickerText(item, products);
    return <div className={`${cls} lo-ticker`}><div style={{ animationDuration: `${Math.max(12, text.length * 0.22)}s` }}><span>{text}</span><span aria-hidden>{text}</span></div></div>;
  }
  const product = promoProduct(item, products, now);
  const w = promoWords(item, product);
  const pic = w.image ? <img src={imageSrc(w.image)} alt="" draggable={false} /> : <b className="lo-pic-empty">🛍️</b>;
  if (item.template === "price-tag") {
    return <div className={`${cls} lo-tag`} key={w.title}>
      <small>{w.badge}</small>
      <strong style={{ fontSize: w.price ? `min(30cqh, ${Math.round(150 / Math.max(w.price.length, 3))}cqw)` : "13cqh" }}>{w.price || "ดูราคาในตะกร้า"}</strong>
      <em>{w.cta.replace(/ ?🛒/, "")}</em>
    </div>;
  }
  if (item.template === "card") {
    return <div className={`${cls} lo-card`} key={w.title}>
      <span className="lo-badge">{w.badge}</span>
      <div className="lo-card-pic">{pic}</div>
      <p>{w.title}</p>
      {w.price ? <strong>{w.price}</strong> : null}
      <em>{w.cta}</em>
    </div>;
  }
  if (item.template === "frame") {
    return <div className={`${cls} lo-frame`}>
      <div className="lo-frame-top"><span>{w.badge}</span><b>{item.title || "🔥 LIVE สด ช้อปในไลฟ์ 🔥"}</b></div>
      <div className="lo-frame-bottom" key={w.title}><span>{product ? product.name : "ถามแพรวได้ทุกเรื่อง"}</span>{w.price ? <b>{w.price}</b> : null}<em>{w.cta}</em></div>
    </div>;
  }
  return <div className={`${cls} lo-banner`} key={w.title}>
    <div className="lo-banner-pic">{pic}</div>
    <div className="lo-banner-copy">
      <span className="lo-badge">{w.badge}</span>
      <p>{w.title}</p>
      {w.fact && !w.price ? <small>{w.fact}</small> : null}
      <div className="lo-banner-row">{w.price ? <strong>{w.price}</strong> : null}<em>{w.cta}</em></div>
    </div>
  </div>;
}
