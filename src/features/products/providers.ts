import { z } from "zod";
import type { NormalizedProduct, ProductSnapshot } from "./types";
export const normalizedProductSchema = z.object({
  external_product_id: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  category_key: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  currency: z.literal("THB"),
  price: z.number().finite().nonnegative().max(1e9),
  original_price: z.number().finite().nonnegative().max(1e9).nullable(),
  commission_rate: z.number().min(0).max(1),
  commission_amount: z.number().finite().nonnegative().max(1e9),
  rating: z.number().min(0).max(5).nullable(),
  review_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  units_sold: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["available","unavailable","discontinued"]),
  competition: z.number().min(0).max(1).nullable(),
  creative_potential: z.number().min(0).max(1).nullable(),
  image_url: z.url().startsWith("https://").nullable(),
  product_url: z.url().startsWith("https://").nullable(),
  provider_metadata: z.record(z.string(),z.unknown()),
});
export interface ProviderObservation { eventId: string; capturedAt: string; product: NormalizedProduct }
export interface ProductProvider {
  readonly name: string;
  getProducts(): Promise<ProviderObservation[]>;
}
export class TikTokShopProductProvider implements ProductProvider {
  readonly name = "tiktok_shop";
  async getProducts(): Promise<ProviderObservation[]> {
    throw new Error("TikTok Shop production adapter is disabled until explicitly authorized.");
  }
}
export const FIXTURE_TIME = "2026-09-15T00:00:00.000Z";
const offsets = [24,12,6,2,1,0];
const scenarios = [
  { id:"A", title:"สินค้าขายดีเก่า เริ่มชะลอ", sales:[100000,100600,100800,100830,100835,100837], reviews:5000, rating:4.8, rate:.12, amount:60, competition:.95 },
  { id:"B", title:"สินค้ามาแรง เร่งตัวต่อเนื่อง", sales:[100,150,220,350,450,650], reviews:600, rating:4.8, rate:.18, amount:90, competition:.25 },
  { id:"C", title:"ยอดกระโดดจากฐานเล็ก", sales:[1,1,1,1,1,5], reviews:2, rating:5, rate:.15, amount:75, competition:.4 },
  { id:"D", title:"สินค้าขายดีสม่ำเสมอ", sales:[500,740,860,940,960,980], reviews:2000, rating:4.8, rate:.15, amount:75, competition:.5 },
  { id:"E", title:"สินค้าที่กำลังตก", sales:[1000,1700,1950,2020,2030,2032], reviews:800, rating:4.5, rate:.15, amount:75, competition:.7 },
  { id:"F", title:"คอมมิชชันสูงแต่ยอดน้อย", sales:[1,1,2,2,2,3], reviews:3, rating:4.9, rate:.5, amount:250, competition:.2 },
  { id:"G", title:"ยอดขายแรง คอมมิชชันต่ำ", sales:[100,150,220,350,450,650], reviews:600, rating:4.8, rate:.001, amount:.5, competition:.25 },
  { id:"H", title:"ห้าดาวจากสองรีวิว", sales:[500,740,860,940,960,980], reviews:2, rating:5, rate:.15, amount:75, competition:.5 },
  { id:"I", title:"4.8 ดาวจากหลายพันรีวิว", sales:[500,740,860,940,960,980], reviews:5000, rating:4.8, rate:.15, amount:75, competition:.5 },
];
export function fixtureObservations(anchor = new Date(FIXTURE_TIME)): ProviderObservation[] {
  return scenarios.flatMap(s => offsets.map((offset,i) => {
    const capturedAt = new Date(anchor.getTime() - offset * 3600000).toISOString();
    return {
      eventId: `fixture-v1:${s.id}:${capturedAt}`, capturedAt,
      product: normalizedProductSchema.parse({
        external_product_id: `fixture-${s.id}`, title:s.title,
        category_key: ["B","G"].includes(s.id) ? "home" : "beauty",
        currency:"THB", price:500, original_price:650, commission_rate:s.rate,
        commission_amount:s.amount, rating:s.rating, review_count:s.reviews,
        units_sold:s.sales[i], status:"available", competition:s.competition,
        creative_potential:.85, image_url:null, product_url:null,
        provider_metadata:{scenario:s.id, source:"deterministic-mock", seed_anchor:anchor.toISOString()},
      }),
    };
  }));
}
export class MockProductProvider implements ProductProvider {
  readonly name = "mock";
  constructor(private anchor = new Date(FIXTURE_TIME)) {}
  async getProducts() { return fixtureObservations(this.anchor); }
}
export function fixtureSnapshots(scenario: string, anchor = new Date(FIXTURE_TIME)): ProductSnapshot[] {
  return fixtureObservations(anchor).filter(o => o.product.external_product_id === `fixture-${scenario}`)
    .map(o => ({...o.product, id:o.eventId, owner_id:"fixture-owner", product_id:scenario,
      captured_at:o.capturedAt, ingestion_event_id:o.eventId}));
}
