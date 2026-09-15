import { expect,it,vi } from "vitest";
import { createProductSnapshot,filterAndSortRadar } from "./services";
import { fixtureObservations } from "./providers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Product,RadarItem } from "./types";
it("passes a stable event identity on retries and validates before RPC",async()=>{
  const observation=fixtureObservations()[0];
  const rpc=vi.fn().mockResolvedValue({data:{id:"snapshot"},error:null});
  const client={rpc} as unknown as SupabaseClient;
  await createProductSnapshot(client,"mock",observation);
  await createProductSnapshot(client,"mock",observation);
  expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
  await expect(createProductSnapshot(client,"mock",{...observation,product:{...observation.product,price:-1}})).rejects.toThrow();
  expect(rpc).toHaveBeenCalledTimes(2);
});
it("filters commission/price and deterministically sorts ties",()=>{
  const items:RadarItem[]=["b","a","c"].map((id,i)=>({
    product:{id,category_key:"home",current_price:500,commission_amount:i===2?1:60,units_sold:100} as Product,score:null,
  }));
  expect(filterAndSortRadar(items,{minCommission:30,minPrice:100,maxPrice:600}).map(r=>r.product.id)).toEqual(["a","b"]);
  expect(filterAndSortRadar(items,{category:"beauty"})).toEqual([]);
  expect(filterAndSortRadar(items,{minConfidence:.5})).toEqual([]);
});
