/**
 * AI LIVE director: which products go live, when they rotate, when each is pinned, and what the host says to a comment.
 *
 * Every number comes from real VIDEO-channel orders imported from TikTok Shop Affiliate reports (never MOCK, never a
 * catalogue listing), and every product claim the host makes comes from owner-verified `content_evidence`. Anything
 * not known is answered as "not known" rather than invented, which also keeps the host inside TikTok's rules on
 * misleading product claims.
 */
export const LIVE_POLICY = {
  minProducts: 3,
  maxProducts: 4,
  refreshHours: 4,
  // A challenger replaces the weakest product only if clearly better, so the lineup does not churn on noise.
  replaceMargin: 1.2,
  segmentMinutes: 15,
  salesWindowDays: 14,
} as const;

export interface LiveCandidate {
  productId: string; title: string; price: number | null;
  /** Real, non-cancelled VIDEO orders and GMV over the sales window. */
  videoOrders: number; videoGmv: number; settledCommission: number;
  lastOrderAt: string | null;
  facts: string[];
}
export interface LiveLineup { productIds: string[]; chosenAt: string; reason: "INITIAL" | "REFRESHED" | "KEPT" | "WAIT_FOR_DATA" }

/** Sales strength: orders matter most, GMV and commission break ties; older demand decays by half each week. */
export function liveScore(c: LiveCandidate, now: Date) {
  if (c.videoOrders <= 0) return 0;
  const ageDays = c.lastOrderAt ? Math.max(0, (now.getTime() - Date.parse(c.lastOrderAt)) / 86400000) : LIVE_POLICY.salesWindowDays;
  const freshness = Math.pow(0.5, ageDays / 7);
  return (c.videoOrders * 10 + Math.log10(1 + c.videoGmv) * 5 + Math.log10(1 + c.settledCommission) * 5) * freshness;
}

/**
 * Picks 3–4 best-selling products. Re-evaluated every 4 hours: a new best-seller replaces the weakest one only when it
 * beats it by the margin. Products without real orders or without a verified fact are never put live.
 */
export function selectLiveLineup(candidates: readonly LiveCandidate[], now: Date, prior: LiveLineup | null = null): LiveLineup {
  const eligible = candidates.filter(c => c.videoOrders > 0 && c.facts.length > 0)
    .map(c => ({ c, score: liveScore(c, now) })).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.productId.localeCompare(b.c.productId));
  const at = now.toISOString();
  if (eligible.length < LIVE_POLICY.minProducts) return { productIds: eligible.map(x => x.c.productId), chosenAt: at, reason: "WAIT_FOR_DATA" };
  const best = eligible.slice(0, LIVE_POLICY.maxProducts).map(x => x.c.productId);
  if (!prior || prior.reason === "WAIT_FOR_DATA" || !prior.productIds.length) return { productIds: best, chosenAt: at, reason: "INITIAL" };
  if (now.getTime() - Date.parse(prior.chosenAt) < LIVE_POLICY.refreshHours * 3600000) return { ...prior, reason: "KEPT" };
  const scores = new Map(eligible.map(x => [x.c.productId, x.score]));
  // Products that stopped selling or lost their facts leave; the rest compete with new best-sellers.
  const kept = prior.productIds.filter(id => scores.has(id));
  const challengers = eligible.filter(x => !kept.includes(x.c.productId));
  let changed = kept.length !== prior.productIds.length;
  while (kept.length < LIVE_POLICY.maxProducts && challengers.length) { kept.push(challengers.shift()!.c.productId); changed = true; }
  for (const challenger of challengers) {
    const weakest = kept.reduce((w, id) => scores.get(id)! < scores.get(w)! ? id : w, kept[0]);
    if (challenger.score > scores.get(weakest)! * LIVE_POLICY.replaceMargin) { kept[kept.indexOf(weakest)] = challenger.c.productId; changed = true; }
  }
  kept.sort((a, b) => scores.get(b)! - scores.get(a)!);
  return { productIds: kept, chosenAt: at, reason: changed ? "REFRESHED" : "KEPT" };
}

export interface LiveSegment { productId: string; startsAt: string; endsAt: string; pinAt: string }
/** Rotates through the lineup in fixed segments; the product is pinned when its segment starts. */
export function liveRunOfShow(lineup: LiveLineup, start: Date, hours: number = LIVE_POLICY.refreshHours, segmentMinutes: number = LIVE_POLICY.segmentMinutes): LiveSegment[] {
  if (!lineup.productIds.length || lineup.reason === "WAIT_FOR_DATA") return [];
  const out: LiveSegment[] = [], ms = segmentMinutes * 60000, count = Math.floor(hours * 60 / segmentMinutes);
  for (let i = 0; i < count; i++) {
    const s = start.getTime() + i * ms;
    out.push({ productId: lineup.productIds[i % lineup.productIds.length], startsAt: new Date(s).toISOString(), endsAt: new Date(s + ms).toISOString(), pinAt: new Date(s).toISOString() });
  }
  return out;
}

export type CommentIntent = "PRICE" | "HOW_TO_BUY" | "SHIPPING" | "DETAIL" | "STOCK" | "GREETING" | "THANKS" | "BANTER" | "UNSAFE" | "OTHER";
const patterns: [CommentIntent, RegExp][] = [
  ["UNSAFE", /รักษา|หายขาด|ยาวิเศษ|ปลอม|โกง|scam|fake|ควย|เหี้ย|สัส|fuck/i],
  ["PRICE", /ราคา|กี่บาท|เท่าไหร่|เท่าไร|ลดไหม|โปร|price|how much/i],
  ["HOW_TO_BUY", /สั่ง|ซื้อ|ตะกร้า|ลิงก์|ลิ้ง|cf|เอฟ|buy|order|link/i],
  ["SHIPPING", /ส่ง|จัดส่ง|กี่วัน|เก็บเงินปลายทาง|cod|ship/i],
  ["STOCK", /หมด|มีของ|เหลือ|stock/i],
  ["DETAIL", /ขนาด|ไซ|size|สี|วัสดุ|ใช้ยังไง|ใช้ได้|กันน้ำ|แบต|ส่วนผสม|สเปค|spec/i],
  ["GREETING", /สวัสดี|หวัดดี|ดีค่ะ|ดีครับ|hello|hi\b|มาแล้ว/i],
  ["THANKS", /ขอบคุณ|thank|ได้รับแล้ว|ชอบมาก/i],
  ["BANTER", /555|ฮา|ตลก|น่ารัก|สวย|หล่อ|เก่ง|ร้องเพลง|กินข้าว|เหนื่อย/i],
];
export function commentIntent(text: string): CommentIntent {
  for (const [intent, re] of patterns) if (re.test(text)) return intent;
  return "OTHER";
}

export interface HostReply { intent: CommentIntent; text: string; grounded: boolean; skip?: boolean }
/**
 * Reply grounded only in the product's verified facts. Prices are given only when a real listing price exists and the
 * viewer is pointed to the pinned cart for the final price. Unsafe comments are skipped, not argued with.
 */
export function hostReply(comment: { user: string; text: string }, product: LiveCandidate | null): HostReply {
  const intent = commentIntent(comment.text), name = comment.user.trim().slice(0, 24) || "คุณลูกค้า";
  const title = product?.title ?? "สินค้าในตะกร้า";
  const fact = (re: RegExp) => product?.facts.find(f => re.test(f)) ?? null;
  switch (intent) {
    case "UNSAFE": return { intent, text: "", grounded: true, skip: true };
    case "PRICE": return product?.price
      ? { intent, grounded: true, text: `คุณ${name} ${title} ราคาในตะกร้าตอนนี้ ${product.price.toLocaleString("th-TH")} บาทค่ะ ราคาสุดท้ายดูที่ตะกร้าที่ปักไว้ได้เลย` }
      : { intent, grounded: true, text: `คุณ${name} ราคาล่าสุดดูที่ตะกร้าที่ปักไว้ได้เลยนะคะ` };
    case "HOW_TO_BUY": return { intent, grounded: true, text: `คุณ${name} กดตะกร้าสีส้มด้านล่าง เลือก ${title} แล้วสั่งได้เลยค่ะ` };
    case "SHIPPING": { const f = fact(/ส่ง|จัดส่ง|ปลายทาง/);
      return { intent, grounded: true, text: f ? `คุณ${name} ${f}` : `คุณ${name} รายละเอียดการจัดส่งดูในหน้าสินค้าในตะกร้าได้เลยค่ะ` }; }
    case "STOCK": return { intent, grounded: true, text: `คุณ${name} จำนวนคงเหลือดูที่ตะกร้าได้เลยค่ะ ถ้ายังกดสั่งได้แปลว่ายังมีของ` };
    case "DETAIL": { const words = comment.text.toLowerCase().split(/\s+/).filter(w => w.length > 1);
      const f = product?.facts.find(x => words.some(w => x.toLowerCase().includes(w))) ?? product?.facts[0] ?? null;
      return f ? { intent, grounded: true, text: `คุณ${name} ${title}: ${f}` }
        : { intent, grounded: true, text: `คุณ${name} ข้อนี้ยังไม่มีข้อมูลยืนยัน ขอไม่เดานะคะ ดูรายละเอียดในหน้าสินค้าได้เลย` }; }
    case "GREETING": return { intent, grounded: true, text: `สวัสดีค่ะคุณ${name} ยินดีต้อนรับนะคะ ตอนนี้กำลังพูดถึง ${title} อยู่ค่ะ` };
    case "THANKS": return { intent, grounded: true, text: `ขอบคุณคุณ${name} มากเลยค่ะ` };
    case "BANTER": return { intent, grounded: true, text: `ฮ่าๆ ขอบคุณคุณ${name} ค่ะ อยู่คุยกันก่อนนะคะ` };
    default: return { intent, grounded: false, text: `คุณ${name} ขอบคุณที่ทักมานะคะ มีคำถามเรื่อง ${title} ถามได้เลยค่ะ` };
  }
}

/**
 * What can and cannot run directly against TikTok today. Stated, not assumed: no public TikTok API exists for a third-party
 * app to start a LIVE, read LIVE comments, or pin a Shop product in a LIVE.
 */
export const LIVE_TIKTOK_BOUNDARY = {
  streamWithoutObs: "The worker can push video straight to TikTok over RTMP with FFmpeg when the owner pastes the server URL and stream key that TikTok LIVE Producer issues to eligible accounts. No OBS needed, but TikTok decides who gets a stream key.",
  readComments: "No official LIVE comment API for third-party apps. Comments must come from an authorized source (or the owner) before the host can reply.",
  pinProduct: "No public API to pin a Shop product in LIVE. The run-of-show gives pin times; pinning is done in TikTok LIVE Producer / the app.",
} as const;

/** Start of the current fixed 4-hour lineup block, so products do not change mid-block. */
export function liveBlockStart(at: Date = new Date()) {
  const block = LIVE_POLICY.refreshHours * 3600000;
  return new Date(Math.floor(at.getTime() / block) * block);
}
