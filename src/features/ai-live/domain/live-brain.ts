import type { LiveComment } from "./comment-engine";
import type { LiveActionType, LiveProduct } from "./types";

export type LiveIntent = "BUY" | "PRICE" | "PRODUCT" | "GREETING" | "GENERAL";

export interface SellerRules {
  /** A verified seller message; used only when no product-specific answer is known. */
  fallbackReply?: string;
  avoidPriceClaims?: boolean;
}

export interface LiveBrainInput {
  comment: LiveComment;
  product: LiveProduct | null;
  sellerRules?: SellerRules;
}

export interface LiveBrainDecision {
  reply: string;
  intent: LiveIntent;
  priority: number;
  suggestedActions: Array<{ type: Extract<LiveActionType, "SPEAK" | "SHOW_PRODUCT">; priority: number }>;
}

export interface LiveBrainProvider {
  decide(input: LiveBrainInput): Promise<LiveBrainDecision>;
}

function intentFor(text: string): LiveIntent {
  if (/(ซื้อ|สั่ง|ตะกร้า|buy|order|checkout)/iu.test(text)) return "BUY";
  if (/(ราคา|เท่าไหร่|กี่บาท|price|cost)/iu.test(text)) return "PRICE";
  if (/(สินค้า|รุ่น|รายละเอียด|product|detail|feature)/iu.test(text)) return "PRODUCT";
  if (/(สวัสดี|หวัดดี|hello|hi\b)/iu.test(text)) return "GREETING";
  return "GENERAL";
}

/** Safe deterministic fallback. It only states product facts supplied by the current record. */
export class RuleBasedLiveBrain implements LiveBrainProvider {
  async decide({ comment, product, sellerRules }: LiveBrainInput): Promise<LiveBrainDecision> {
    const intent = intentFor(comment.normalizedText);
    const thai = comment.language === "th";
    const available = product?.status === "available";
    let reply: string;
    if (intent === "GREETING") {
      reply = thai ? "สวัสดีค่ะ ยินดีต้อนรับค่ะ" : "Hello, welcome!";
    } else if (!product || !available) {
      reply = sellerRules?.fallbackReply?.trim()
        || (thai ? "ตอนนี้ยังไม่มีข้อมูลสินค้าที่พร้อมแนะนำค่ะ" : "I don't have an available product to recommend yet.");
    } else if (intent === "PRICE") {
      const verifiedPrice = product.current_price;
      reply = !sellerRules?.avoidPriceClaims && typeof verifiedPrice === "number"
        && Number.isFinite(verifiedPrice) && verifiedPrice > 0 && product.currency === "THB"
        ? (thai ? `${product.title} ราคา ${verifiedPrice.toFixed(2)} บาทค่ะ` : `${product.title} is ${verifiedPrice.toFixed(2)} THB.`)
        : (thai ? "ตอนนี้ยังไม่มีราคาที่ตรวจสอบได้ค่ะ" : "I don't have a verified price right now.");
    } else if (intent === "BUY") {
      reply = thai
        ? `ตอนนี้กำลังแนะนำ ${product.title} ค่ะ โปรดตรวจสอบรายละเอียดและช่องทางสั่งซื้อในหน้าสินค้าก่อนตัดสินใจ`
        : `We're featuring ${product.title}. Please check the product details and purchase options before ordering.`;
    } else {
      reply = thai
        ? `ตอนนี้กำลังแนะนำ ${product.title} ค่ะ หากมีคำถามเกี่ยวกับสินค้า ถามได้เลย`
        : `We're featuring ${product.title}. Ask if you have a question about it.`;
    }
    const priority = Math.max(0, Math.min(100, comment.priority));
    return {
      reply,
      intent,
      priority,
      suggestedActions: [
        ...(available && ["BUY", "PRICE", "PRODUCT"].includes(intent)
          ? [{ type: "SHOW_PRODUCT" as const, priority }] : []),
        { type: "SPEAK" as const, priority },
      ],
    };
  }
}
