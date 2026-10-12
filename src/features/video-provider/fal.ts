import "server-only";
import { buildFalModelInput, getFalModelCost, FAL_MODEL_ENDPOINTS, resolveFalModelSettings } from "@/features/video/fal-models";
import { createFalQueueClient, FalWanVideoProvider, type FalWanClient } from "@/features/video/fal-wan";
export interface FalRequest { endpoint: string; input: Record<string,unknown>; estimateUsd: number; settings: ReturnType<typeof resolveFalModelSettings>; }
export class RoutedFalProvider {
  readonly provider = "fal_ai";
  readonly queue: FalWanClient;
  constructor(private key: string, private fetcher: typeof fetch = fetch, queue?: FalWanClient) { this.queue = queue ?? createFalQueueClient(key, fetcher); }
  async prepare(model: string, imageUrl: string, prompt: string): Promise<FalRequest> {
    if (!this.key) throw new Error("FAL_UNAVAILABLE");
    const settings = resolveFalModelSettings({ model, durationSeconds: 8, aspectRatio: "9:16" });
    const input = buildFalModelInput(settings, { imageUrl, prompt });
    if (model !== FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED) input.generate_audio = true;
    input.enable_safety_checker = true;
    const url = new URL("https://api.fal.ai/v1/models/pricing"); url.searchParams.set("endpoint_id", model);
    const response = await this.fetcher(url, { headers: { Authorization: `Key ${this.key}` }, redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("FAL_PRICE_UNAVAILABLE");
    const body = await response.json() as {has_more?:boolean;prices?:Array<{endpoint_id:string;unit:string;unit_price:number;currency:string}>};
    const price = body.prices?.find(row => row.endpoint_id === model);
    if (body.has_more || !price || price.unit !== "seconds" || price.currency !== "USD" || !Number.isFinite(price.unit_price) || price.unit_price <= 0 || !settings.durationSeconds) throw new Error("FAL_PRICE_UNAVAILABLE");
    // Preserve the audio-on catalog ceiling if a pricing feed returns a cheaper base tier.
    const ceiling=Math.max(price.unit_price * settings.durationSeconds,getFalModelCost(settings).reservedCostUsd);
    return { endpoint: model, settings, input, estimateUsd: Math.ceil(ceiling * 1.1 * 1e6) / 1e6 };
  }
  async submit(request: FalRequest) { return this.queue.submit(request.endpoint, request.input, AbortSignal.timeout(20_000)); }
  async poll(request: FalRequest, id: string) {
    const state = await this.queue.status(request.endpoint, id, AbortSignal.timeout(15_000));
    if (state.error || state.error_type) return { status: "FAILED" as const };
    if (state.status !== "COMPLETED") return { status: "PENDING" as const };
    return { status: "COMPLETE" as const };
  }
  async retrieve(request: FalRequest, id: string) {
    // Reuse the reviewed downloader, signature validation, bounds and host allowlist.
    return new FalWanVideoProvider({ apiKey: this.key, settings: request.settings, client: this.queue, fetchImpl: this.fetcher,
      maxPollAttempts: 1, readRetryAttempts: 0 }).retrieve(id);
  }
  /** Official billed events only. Missing permission/event/pagination completeness means UNKNOWN, never zero. */
  async billedCost(request:FalRequest,id:string,createdAt:string):Promise<number|null>{
    if(!this.key)return null;
    const date=Date.parse(createdAt);if(!Number.isFinite(date)||Date.now()-date>89*24*60*60_000)return null;
    const url=new URL("https://api.fal.ai/v1/models/billing-events");
    url.searchParams.set("request_id",id);url.searchParams.set("endpoint_id",request.endpoint);url.searchParams.set("limit","50");url.searchParams.set("start",new Date(date-300_000).toISOString());
    try{
      const response=await this.fetcher(url,{headers:{Authorization:`Key ${this.key}`},redirect:"error",signal:AbortSignal.timeout(10_000)});
      if(!response.ok)return null;
      const body=await response.json() as {has_more?:boolean;next_cursor?:string|null;billing_events?:Array<{request_id:string;endpoint_id:string;cost_total:number}>};
      if(body.has_more!==false||body.next_cursor||!body.billing_events?.length)return null;
      if(body.billing_events.some(event=>event.request_id!==id||event.endpoint_id!==request.endpoint||typeof event.cost_total!=="number"||!Number.isFinite(event.cost_total)||event.cost_total<0))return null;
      return Number(body.billing_events.reduce((sum,event)=>sum+event.cost_total,0).toFixed(6));
    }catch{return null;}
  }
}
