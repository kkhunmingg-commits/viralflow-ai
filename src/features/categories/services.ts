import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountCategoryAffinity } from "@/features/accounts/types";
import { getOwnerAccounts } from "@/features/accounts/queries";
import { getProductRadar } from "@/features/products/services";
import type { ProductSnapshot } from "@/features/products/types";
import { aggregateCategorySnapshot,calculateAccountCategoryFit,calculateCategoryMomentum } from "./scoring";
import type { Category,CategoryDetail,CategoryProductInput,CategoryRadarItem,CategoryScore,CategorySnapshot } from "./types";

async function readAll<T>(client:SupabaseClient,table:string,owner:string):Promise<T[]> {
 const rows:T[]=[];
 for(let offset=0;;offset+=500){const {data,error}=await client.from(table).select("*").eq("owner_id",owner).order("id").range(offset,offset+499);if(error)throw new Error(`Category data could not be loaded: ${error.message}`);rows.push(...(data??[]) as T[]);if(!data||data.length<500)return rows;}
}
function latestBy<T extends {category_id?:string;calculated_at?:string;captured_at?:string}>(rows:T[]){const map=new Map<string,T>();for(const row of rows){const id=row.category_id??"";const time=row.calculated_at??row.captured_at??"";const current=map.get(id);if(!current||time>(current.calculated_at??current.captured_at??""))map.set(id,row);}return map;}

export async function persistCategoryIntelligence(client:SupabaseClient,owner:string,now=new Date()) {
 const radar=await getProductRadar(client,owner,{},now);
 const snapshots=await readAll<ProductSnapshot>(client,"product_snapshots",owner);
 const byProduct=new Map<string,ProductSnapshot[]>();for(const s of snapshots){const g=byProduct.get(s.product_id)??[];g.push(s);byProduct.set(s.product_id,g);}
 const groups=new Map<string,CategoryProductInput[]>();for(const item of radar.items){if(!item.score)continue;const g=groups.get(item.product.category_key)??[];g.push({product:item.product,score:item.score,history:byProduct.get(item.product.id)??[]});groups.set(item.product.category_key,g);}
 for(const [key,items] of groups){const first=items.map(i=>i.product.first_seen_at).sort()[0],last=items.map(i=>i.product.last_seen_at).sort().at(-1)!;
  const {data:category,error:categoryError}=await client.from("categories").upsert({owner_id:owner,category_key:key,display_name:key.replaceAll("-"," ").replace(/\b\w/g,c=>c.toUpperCase()),parent_category_key:null,provider:"mock",status:"active",first_seen_at:first,last_seen_at:last},{onConflict:"owner_id,provider,category_key"}).select().single();if(categoryError)throw new Error(categoryError.message);
  const aggregate=aggregateCategorySnapshot(items,now.toISOString());const {data:snapshot,error:snapshotError}=await client.from("category_snapshots").insert({...aggregate.snapshot,owner_id:owner,category_id:category.id}).select().single();if(snapshotError&&snapshotError.code!=="23505")throw new Error(snapshotError.message);if(!snapshot)continue;
  const score=calculateCategoryMomentum(aggregate,now);const {error:scoreError}=await client.from("category_scores").insert({...score,owner_id:owner,category_id:category.id,snapshot_id:snapshot.id});if(scoreError&&scoreError.code!=="23505")throw new Error(scoreError.message);
 }
 return {categories:groups.size};
}

export interface CategoryFilters {state?:string;minMomentum?:number;minConfidence?:number;minCommercial?:number;account?:string;sort?:"relevant"|"momentum"|"commercial"|"acceleration"|"fit"}
export function filterAndSortCategories(items:CategoryRadarItem[],filters:CategoryFilters){const filtered=items.filter(i=>(!filters.state||i.score.state===filters.state)&&i.score.category_momentum_score>=(filters.minMomentum??0)&&i.snapshot.data_confidence>=(filters.minConfidence??0)&&i.score.commercial_opportunity_score>=(filters.minCommercial??0)&&(!filters.account||i.fits.some(f=>f.account.id===filters.account)));const value=(i:CategoryRadarItem)=>filters.sort==="momentum"?i.score.category_momentum_score:filters.sort==="commercial"?i.score.commercial_opportunity_score:filters.sort==="acceleration"?i.snapshot.sales_acceleration:filters.sort==="fit"?i.bestAccount?.score??-1:i.bestAccount?.score??Math.max(i.score.category_momentum_score,i.score.commercial_opportunity_score);return filtered.toSorted((a,b)=>value(b)-value(a)||a.category.id.localeCompare(b.category.id));}

export async function getCategoryRadar(client:SupabaseClient,owner:string,filters:CategoryFilters={}) {
 const [categories,snapshots,scores,accounts,affinities]=await Promise.all([readAll<Category>(client,"categories",owner),readAll<CategorySnapshot>(client,"category_snapshots",owner),readAll<CategoryScore>(client,"category_scores",owner),getOwnerAccounts(client,owner),readAll<AccountCategoryAffinity>(client,"account_category_affinity",owner)]);
 const latestSnapshots=latestBy(snapshots),latestScores=latestBy(scores);
 const items:CategoryRadarItem[]=categories.flatMap(category=>{const snapshot=latestSnapshots.get(category.id),score=latestScores.get(category.id);if(!snapshot||!score)return[];const fits=accounts.map(account=>{const affinity=affinities.find(a=>a.tiktok_account_id===account.id&&a.category_key===category.category_key)??null;const calculated=calculateAccountCategoryFit(account,score,affinity);return {account,affinity,...calculated};}).toSorted((a,b)=>b.score-a.score);const selected=filters.account?fits.find(f=>f.account.id===filters.account)??null:fits[0]??null;return[{category,snapshot,score,fits,bestAccount:selected}];});
 return {items:filterAndSortCategories(items,filters),accounts,total:items.length};
}

export async function getCategoryDetail(client:SupabaseClient,owner:string,id:string):Promise<CategoryDetail|null>{const radar=await getCategoryRadar(client,owner);const item=radar.items.find(i=>i.category.id===id);if(!item)return null;const [snapshots,scores,products]=await Promise.all([readAll<CategorySnapshot>(client,"category_snapshots",owner),readAll<CategoryScore>(client,"category_scores",owner),getProductRadar(client,owner,{category:item.category.category_key})]);return{...item,snapshotHistory:snapshots.filter(s=>s.category_id===id).toSorted((a,b)=>b.captured_at.localeCompare(a.captured_at)),scoreHistory:scores.filter(s=>s.category_id===id).toSorted((a,b)=>b.calculated_at.localeCompare(a.calculated_at)),products:products.items};}

export async function getCategorySignals(client:SupabaseClient,owner:string){const {items}=await getCategoryRadar(client,owner);return new Map(items.map(i=>[i.category.category_key,{state:i.score.state,momentum:i.score.category_momentum_score}]));}
