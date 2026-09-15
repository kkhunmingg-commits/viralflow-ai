import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateProductScore, calculateSalesVelocity } from "./scoring";
import { normalizedProductSchema } from "./providers";
import type { ProductProvider, ProviderObservation } from "./providers";
import type { Product, ProductSnapshot, ProductScore, RadarItem, Trend } from "./types";

export async function createProductSnapshot(client: SupabaseClient, provider: string, observation: ProviderObservation) {
  const normalized = normalizedProductSchema.parse(observation.product);
  if (!observation.eventId || !Number.isFinite(Date.parse(observation.capturedAt))) throw new Error("Invalid ingestion identity or time");
  const { data,error } = await client.rpc("ingest_product_observation", {
    p_provider: provider, p_event: observation.eventId, p_captured: observation.capturedAt, p_product: normalized,
  });
  if(error) throw new Error("Snapshot ingestion failed: " + error.message);
  return data as ProductSnapshot;
}

async function readAll<T>(client: SupabaseClient, table: string, owner: string, productId?: string, through?: string): Promise<T[]> {
  const rows: T[] = [];
  for(let offset=0;;offset+=500) {
    let query=client.from(table).select("*").eq("owner_id",owner).order("id",{ascending:true}).range(offset,offset+499);
    if(productId) query=query.eq(table==="products"?"id":"product_id",productId);
    if(through) query=query.lte("captured_at",through);
    const {data,error}=await query;
    if(error) throw new Error("Product data could not be loaded: "+error.message);
    rows.push(...(data??[]) as T[]);
    if(!data || data.length<500) return rows;
  }
}

export async function ingestProducts(client: SupabaseClient, owner: string, provider: ProductProvider, now = new Date()) {
  const observations=(await provider.getProducts()).toSorted((a,b)=>a.capturedAt.localeCompare(b.capturedAt));
  const touched=new Set<string>();
  for(const observation of observations) {
    const snapshot=await createProductSnapshot(client,provider.name,observation);
    if(snapshot.owner_id!==owner) throw new Error("Ingestion owner mismatch");
    const rows=await readAll<ProductSnapshot>(client,"product_snapshots",owner,snapshot.product_id,snapshot.captured_at);
    const score=calculateProductScore(rows,now);
    const record={...score,owner_id:owner,product_id:snapshot.product_id,snapshot_id:snapshot.id};
    const {error}=await client.from("product_scores").insert(record);
    // A retry repairs an unfinished score write; a completed version is immutable.
    if(error && error.code!=="23505") throw new Error("Score persistence failed: "+error.message);
    touched.add(snapshot.product_id);
  }
  return { products:touched.size, observations:observations.length };
}

export interface RadarFilters {
  category?: string; minCommission?: number; minConfidence?: number;
  minScore?: number; trend?: Trend; minPrice?: number; maxPrice?: number;
  sort?: "opportunity" | "momentum" | "commission" | "acceleration" | "units";
}
export function filterAndSortRadar(items: RadarItem[], filters: RadarFilters): RadarItem[] {
  const filtered=items.filter(({product:p,score:s})=>
    (!filters.category || p.category_key===filters.category) &&
    p.commission_amount >= (filters.minCommission??0) &&
    (s?.data_confidence??0)>=(filters.minConfidence??0) &&
    (s?.viral_opportunity_base_score??0)>=(filters.minScore??0) &&
    (!filters.trend || s?.explanation_json.trend===filters.trend) &&
    p.current_price >= (filters.minPrice??0) && p.current_price <= (filters.maxPrice??Infinity));
  function value(item:RadarItem) {
    switch(filters.sort) {
      case "momentum": return item.score?.product_momentum_score??-1;
      case "commission": return item.product.commission_amount;
      case "acceleration": return item.score?.sales_acceleration??-Infinity;
      case "units": return item.product.units_sold;
      default: return item.score?.viral_opportunity_base_score??-1;
    }
  }
  return filtered.toSorted((a,b)=>value(b)-value(a)||a.product.id.localeCompare(b.product.id));
}

export async function getProductRadar(client: SupabaseClient,owner:string,filters:RadarFilters={},now=new Date()) {
  const [products,snapshots]=await Promise.all([
    readAll<Product>(client,"products",owner),readAll<ProductSnapshot>(client,"product_snapshots",owner),
  ]);
  const grouped=new Map<string,ProductSnapshot[]>();
  for(const row of snapshots) {
    const group=grouped.get(row.product_id)??[]; group.push(row); grouped.set(row.product_id,group);
  }
  const items=products.map(product=> {
    const rows=grouped.get(product.id)??[];
    return { product, score:rows.length?calculateProductScore(rows,now):null };
  });
  return { items:filterAndSortRadar(items,filters), categories:[...new Set(products.map(p=>p.category_key))].sort(), total:products.length };
}

export async function getProductDetail(client:SupabaseClient,owner:string,id:string,now=new Date()) {
  const [products,snapshots,scores]=await Promise.all([
    readAll<Product>(client,"products",owner,id),readAll<ProductSnapshot>(client,"product_snapshots",owner,id),
    readAll<ProductScore>(client,"product_scores",owner,id),
  ]);
  if(!products.length) return null;
  const history=snapshots.toSorted((a,b)=>a.captured_at.localeCompare(b.captured_at));
  const capturedById=new Map(history.map(row=>[row.id,row.captured_at]));
  const velocityHistory=history.map((row,i)=>({...row,velocity_1h:calculateSalesVelocity(history.slice(0,i+1),1,new Date(row.captured_at))}));
  return { product:products[0], snapshots:velocityHistory,
    score:history.length?calculateProductScore(history,now):null,
    scores:scores.toSorted((a,b)=>(capturedById.get(b.snapshot_id??"")??"").localeCompare(capturedById.get(a.snapshot_id??"")??"") || b.calculated_at.localeCompare(a.calculated_at)) };
}
