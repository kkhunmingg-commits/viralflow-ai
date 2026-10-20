import { channelRevenue } from "../analytics/report-import";
import { isTestProduct } from "../content-bank/policy";

/** What is actually known about one product for one account, each item labelled by where it came from.
 * Catalogue figures stay "listed" until real orders confirm them; nothing missing is filled in. */
export type Known<T> = { status: "VERIFIED" | "OWNER_REPORTED" | "CATALOG_LISTED" | "UNKNOWN" | "WAIT_FOR_DATA" | "TEST_DATA"; value: T | null; basis: string };
export interface ProductEvidenceInput {
  product: { id: string; title: string; external_provider: string; provider_metadata?: unknown; current_price: number | null; commission_rate: number | null };
  verifiedFacts: number; rightsClearedFootage: number; rightsClearedImages: number; operationFootage: number;
  orders: Parameters<typeof channelRevenue>[0]; actualCostThb: number | null; postsWithResults: number;
}
export function productEvidenceSummary(input: ProductEvidenceInput) {
  const test = isTestProduct(input.product);
  const tag = <T,>(known: Known<T>): Known<T> => test ? { status: "TEST_DATA", value: known.value, basis: "สินค้าทดสอบ ใช้ตัดสินใจจริงไม่ได้" } : known;
  const revenue = channelRevenue(input.orders), video = revenue.VIDEO, live = revenue.LIVE;
  const settled = (video?.settledCommission ?? 0) + (live?.settledCommission ?? 0);
  return {
    productId: input.product.id, testProduct: test,
    facts: tag({ status: input.verifiedFacts ? "VERIFIED" : "WAIT_FOR_DATA", value: input.verifiedFacts, basis: input.verifiedFacts ? "ข้อเท็จจริงที่เจ้าของตรวจและอ้างที่มาแล้ว" : "ยังไม่มีข้อเท็จจริงที่ตรวจแล้ว ห้ามอ้างคุณสมบัติ" }),
    media: tag({ status: input.rightsClearedFootage + input.rightsClearedImages ? "VERIFIED" : "WAIT_FOR_DATA",
      value: { footage: input.rightsClearedFootage, images: input.rightsClearedImages, operationFootage: input.operationFootage },
      basis: input.operationFootage ? "มีวิดีโอจริงที่แสดงการทำงาน" : "ยังไม่มีวิดีโอจริงที่แสดงการทำงาน จึงห้ามอ้างการสาธิต" }),
    listedCommissionRate: tag({ status: input.product.commission_rate === null ? "UNKNOWN" : "CATALOG_LISTED", value: input.product.commission_rate,
      basis: "อัตราที่แค็ตตาล็อกแสดง ยังไม่ใช่รายได้ที่ได้รับจริง" }),
    // VIDEO and LIVE are separate lines; a combined figure would count an order the two channels both claim.
    commissionByChannel: tag({ status: input.orders.length ? "OWNER_REPORTED" : "WAIT_FOR_DATA", value: revenue,
      basis: input.orders.length ? "จากรายงานออเดอร์ Affiliate ที่เจ้าของนำเข้า แยกตามช่องทางที่รายงานระบุ" : "ยังไม่มีรายงานออเดอร์จริง" }),
    profitThb: tag(input.orders.length && input.actualCostThb !== null
      ? { status: "OWNER_REPORTED", value: Math.round((settled - input.actualCostThb) * 100) / 100, basis: "ค่าคอมที่ได้รับจริงลบค่าใช้จ่ายจริง (ไม่รวมเวลาเครื่องที่ประมาณ)" }
      : { status: "UNKNOWN", value: null, basis: "ต้องมีทั้งค่าคอมที่ได้รับจริงและค่าใช้จ่ายจริงก่อน" }),
    accountHistory: tag({ status: input.postsWithResults >= 6 ? "OWNER_REPORTED" : "WAIT_FOR_DATA", value: input.postsWithResults,
      basis: input.postsWithResults >= 6 ? "มีผลโพสต์จริงพอเริ่มเปรียบเทียบ" : `มีผลโพสต์จริง ${input.postsWithResults} คลิป ต้องมีอย่างน้อย 6 คลิปในหลายวันก่อนสรุป` }),
    tiktokTrend: { status: "WAIT_FOR_DATA" as const, value: null, basis: "ยังไม่มีสิทธิ์ข้อมูลเทรนด์ TikTok ทางการ ไม่สันนิษฐานว่ามี Trending API" },
  };
}
