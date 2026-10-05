import {z} from "zod";
import {getFalModelCost,resolveFalModelSettings} from "./fal-models";
import type {BenchmarkCandidate} from "../video-benchmark/types";

const pricesSchema=z.object({prices:z.array(z.object({endpoint_id:z.string(),unit_price:z.number().finite().nonnegative(),unit:z.string(),currency:z.literal("USD")})),has_more:z.boolean()});
const estimateSchema=z.object({total_cost:z.number().finite().nonnegative(),currency:z.literal("USD")});
/** Read-only pricing calls, never a generation or a paid retry. Fail closed on missing/ambiguous billing units. */
export async function verifyFalBenchmarkPrices(candidates:BenchmarkCandidate[],apiKey:string,fetchImpl:typeof fetch=fetch){
  if(!apiKey)throw new Error("FAL_KEY is required for live pricing verification");
  if(candidates.some(row=>row.provider!=="fal"))throw new Error("This price precheck is fal-only");
  const headers={Authorization:`Key ${apiKey}`,"Content-Type":"application/json",Accept:"application/json"};
  const url=new URL("https://api.fal.ai/v1/models/pricing");url.searchParams.set("endpoint_id",candidates.map(row=>row.apiModel).join(","));
  const response=await fetchImpl(url,{headers,signal:AbortSignal.timeout(15000),redirect:"error"});
  if(!response.ok)throw new Error(`Pricing precheck unavailable (${response.status}); no generation submitted`);
  const prices=pricesSchema.parse(await response.json());
  if(prices.has_more)throw new Error("Incomplete pricing response; no generation submitted");
  const verified=[];
  for(const candidate of candidates){
    const price=prices.prices.find(row=>row.endpoint_id===candidate.apiModel);
    if(!price)throw new Error("Missing current price; no generation submitted");
    const settings=resolveFalModelSettings({model:candidate.apiModel,durationSeconds:8,resolution:candidate.id==="fal_ltx_2_3_fast"?"1080p":"720p",aspectRatio:"9:16"});
    const unit=price.unit.toLowerCase();
    const quantity=["second","seconds","s"].includes(unit)?settings.durationSeconds:unit==="video"&&settings.durationSeconds===null?1:null;
    if(quantity===null)throw new Error("Unverified duration billing unit; no generation submitted");
    const quoteResponse=await fetchImpl("https://api.fal.ai/v1/models/pricing/estimate",{method:"POST",headers,redirect:"error",signal:AbortSignal.timeout(15000),body:JSON.stringify({estimate_type:"unit_price",endpoints:{[candidate.apiModel]:{unit_quantity:quantity}}})});
    if(!quoteResponse.ok)throw new Error(`Cost estimate unavailable (${quoteResponse.status}); no generation submitted`);
    const quote=estimateSchema.parse(await quoteResponse.json());
    const reserved=Math.ceil(Math.max(quote.total_cost,price.unit_price*quantity,getFalModelCost(settings).reservedCostUsd,candidate.expectedCostUsd)*1e6)/1e6;
    verified.push({...candidate,expectedCostUsd:reserved,pricingVerifiedAt:new Date().toISOString(),pricingUnit:price.unit,pricingUnitPriceUsd:price.unit_price});
  }
  return verified;
}
