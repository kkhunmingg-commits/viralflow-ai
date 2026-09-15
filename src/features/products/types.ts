export type Trend = "ACCELERATING" | "RISING" | "STABLE" | "FALLING" | "LOW_DATA";
export interface ProductMetrics {
  price: number; original_price: number | null; commission_rate: number;
  commission_amount: number; rating: number | null; review_count: number;
  units_sold: number; status: "available" | "unavailable" | "discontinued";
  competition: number | null; creative_potential: number | null;
}
export interface NormalizedProduct extends ProductMetrics {
  external_product_id: string; title: string; category_key: string;
  image_url: string | null; product_url: string | null; currency: "THB";
  provider_metadata: Record<string, unknown>;
}
export interface Product extends Omit<NormalizedProduct, "price" | "competition" | "creative_potential"> {
  id: string; owner_id: string; external_provider: string; slug: string;
  current_price: number; first_seen_at: string; last_seen_at: string;
  created_at: string; updated_at: string;
}
export interface ProductSnapshot extends ProductMetrics {
  id: string; owner_id: string; product_id: string; captured_at: string;
  ingestion_event_id: string; provider_metadata: Record<string, unknown>;
}
export interface Signal { score: number; reason: string }
export interface Explanation {
  signals: Record<string, Signal>; confidence: number; historyHours: number;
  salesDelta: number; staleHours: number; counterReset: boolean;
  velocities: { "1h": number | null; "6h": number | null; "24h": number | null };
  acceleration: number; trend: Trend; assumptions: string[];
}
export interface ProductScore {
  id?: string; owner_id?: string; product_id?: string; snapshot_id?: string;
  calculated_at: string; score_version: string; sales_velocity: number;
  sales_acceleration: number; price_attractiveness: number; commission_score: number;
  rating_score: number; review_confidence: number; competition_score: number;
  creative_potential_score: number; data_confidence: number;
  product_momentum_score: number; viral_opportunity_base_score: number;
  explanation_json: Explanation;
}
export interface RadarItem { product: Product; score: ProductScore | null }
