import {it,expect,vi,describe} from "vitest";
vi.mock("server-only",()=>({}));
import {RoutedFalProvider} from "./fal";
import {FAL_MODEL_ENDPOINTS} from "@/features/video/fal-models";
describe("fal adapter read-only pricing and one submit",()=>{
  it("reads a complete, matching request billing event",async()=>{const fetcher=vi.fn(async()=>new Response(JSON.stringify({billing_events:[{request_id:"known",endpoint_id:FAL_MODEL_ENDPOINTS.LTX_23_FAST,cost_total:.42}],has_more:false,next_cursor:null}))) as unknown as typeof fetch;
    const p=new RoutedFalProvider("test",fetcher),request={endpoint:FAL_MODEL_ENDPOINTS.LTX_23_FAST,input:{},estimateUsd:.5,settings:{} as never};expect(await p.billedCost(request,"known",new Date().toISOString())).toBe(.42);expect(String(vi.mocked(fetcher).mock.calls[0][0])).toContain("request_id=known");});
  it.each([{billing_events:[],has_more:false},{billing_events:[{request_id:"another",cost_total:.1}],has_more:false},{billing_events:[{request_id:"known",endpoint_id:FAL_MODEL_ENDPOINTS.LTX_23_FAST,cost_total:.1}],has_more:true}])("never invents billing for incomplete/mismatched events",async body=>{const p=new RoutedFalProvider("test",async()=>new Response(JSON.stringify(body)));expect(await p.billedCost({endpoint:FAL_MODEL_ENDPOINTS.LTX_23_FAST,input:{},estimateUsd:.5,settings:{} as never},"known",new Date().toISOString())).toBeNull();});
  it.each([FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED,FAL_MODEL_ENDPOINTS.LTX_23_FAST,FAL_MODEL_ENDPOINTS.WAN_26_FLASH])("builds supported real input and safety for %s",async model=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({prices:[{endpoint_id:model,unit:"seconds",currency:"USD",unit_price:.06}]}))) as unknown as typeof fetch;
    const p=new RoutedFalProvider("test-key-not-real",fetcher);const quote=await p.prepare(model,"https://project.supabase.co/storage/photo.jpg","Thai product creative");
    expect(quote.estimateUsd).toBeGreaterThanOrEqual(.48);expect(quote.input.enable_safety_checker).toBe(true);
    expect(quote.input.generate_audio).toBe(model===FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED?undefined:true);
    expect(fetcher).toHaveBeenCalledOnce();expect(String(vi.mocked(fetcher).mock.calls[0][0])).toContain("/models/pricing");
    expect(vi.mocked(fetcher).mock.calls[0][1]?.method).toBeUndefined();expect(JSON.stringify(quote)).not.toContain("test-key-not-real");
  });
  it.each([{prices:[]},{has_more:true,prices:[]},{prices:[{endpoint_id:FAL_MODEL_ENDPOINTS.LTX_23_FAST,unit:"video",currency:"USD",unit_price:.01}]}])("fails closed for ambiguous prices",async body=>{
    const p=new RoutedFalProvider("test",async()=>new Response(JSON.stringify(body)));await expect(p.prepare(FAL_MODEL_ENDPOINTS.LTX_23_FAST,"https://example.com/a.jpg","a")).rejects.toThrow("FAL_PRICE_UNAVAILABLE");
  });
  it("never automatically retries submit after a lost response",async()=>{
    const fetcher=vi.fn(async()=>{throw new Error("lost response");}) as unknown as typeof fetch;
    const p=new RoutedFalProvider("test",fetcher);await expect(p.submit({endpoint:FAL_MODEL_ENDPOINTS.LTX_23_FAST,input:{},estimateUsd:.5,settings:{} as never})).rejects.toThrow();expect(fetcher).toHaveBeenCalledOnce();
  });
});
