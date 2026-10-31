import type {BenchmarkCandidate,BenchmarkModel} from "./types";

const RUNWAY_PRICING="https://docs.dev.runwayml.com/guides/pricing/";
const FAL_WAN="https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video/turbo";
const PIXVERSE_PRICING="https://docs.platform.pixverse.ai/pricing-796039m0";
const TIKTOK_SYMPHONY="https://ads.tiktok.com/creative/creativeCenter/tools/api";
const META_VIBES="https://about.fb.com/news/2025/09/introducing-vibes-ai-videos/";
const GOOGLE_VEO="https://ai.google.dev/gemini-api/docs/veo";
const GOOGLE_FLOW="https://support.google.com/flow/answer/16526234";
export const BENCHMARK_CANDIDATES:readonly BenchmarkCandidate[]=[
  {id:"google_flow_manual",provider:"google_flow_manual",apiModel:"consumer-flow-manual",label:"Google Flow owner reference",resolution:"Owner supplied; normalized locally",expectedCostUsd:0,minimumCostUsd:0,sourceUrl:GOOGLE_FLOW,availability:"MANUAL_BENCHMARK_ONLY",limitation:"Google Flow is a consumer product with separate credits and no documented supported automation API. Owner-supplied clips are manual benchmark references only."},
  {id:"veo_3_1_lite",provider:"google_veo",apiModel:"veo-3.1-lite-generate-preview",label:"Google Veo 3.1 Lite",resolution:"720p portrait",expectedCostUsd:.40,minimumCostUsd:.40,sourceUrl:GOOGLE_VEO,availability:"READY",limitation:"Paid Gemini API model; requires explicit paid-mode opt-in, an API key, a hard budget cap, and owner Flow comparison before routing."},
  {id:"veo_3_1_fast",provider:"google_veo",apiModel:"veo-3.1-fast-generate-preview",label:"Google Veo 3.1 Fast",resolution:"720p portrait",expectedCostUsd:.80,minimumCostUsd:.80,sourceUrl:GOOGLE_VEO,availability:"READY",limitation:"Quality-ceiling candidate only; not part of the first paid stage unless Lite fails or needs comparison."},
  {id:"veo_3_1_standard",provider:"google_veo",apiModel:"veo-3.1-generate-preview",label:"Google Veo 3.1 Standard",resolution:"720p portrait",expectedCostUsd:3.20,minimumCostUsd:3.20,sourceUrl:GOOGLE_VEO,availability:"READY",limitation:"Premium quality-ceiling candidate; never the cost-first default."},
  {id:"meta_vibes",provider:"meta_vibes",apiModel:"consumer-vibes-manual",label:"Meta AI / Vibes",resolution:"Undocumented; normalized locally to 720x1280",expectedCostUsd:0,minimumCostUsd:0,sourceUrl:META_VIBES,availability:"MANUAL_BENCHMARK_ONLY",limitation:"No supported public Meta video-generation API. Owner-supplied output may be imported for evaluation, but human labor and consumer quotas prevent Auto Mode use."},
  {id:"fal_wan_2_2_turbo",provider:"fal",apiModel:"fal-ai/wan/v2.2-a14b/image-to-video/turbo",label:"fal Wan 2.2 Turbo",resolution:"720p portrait",expectedCostUsd:.10,minimumCostUsd:.10,sourceUrl:FAL_WAN,availability:"READY",limitation:null},
  {id:"pixverse_v6",provider:"pixverse",apiModel:"v6",label:"PixVerse V6",resolution:"720p portrait",expectedCostUsd:.72,minimumCostUsd:.32,sourceUrl:PIXVERSE_PRICING,availability:"READY",limitation:"Eight seconds uses 72 credits. USD cost varies by PixVerse API credit package; $0.72 is the conservative package-rate forecast."},
  {id:"tiktok_symphony",provider:"tiktok_symphony",apiModel:"symphony-image-to-video",label:"TikTok Symphony API",resolution:"portrait",expectedCostUsd:0,minimumCostUsd:0,sourceUrl:TIKTOK_SYMPHONY,availability:"NOT_RUN",limitation:"No approved Symphony API application, access token, advertiser scope, or public unit price is available in this environment."},
  {id:"gen4_turbo",provider:"runway",apiModel:"gen4_turbo",label:"Runway Gen-4 Turbo",resolution:"720x1280",expectedCostUsd:.40,minimumCostUsd:.40,sourceUrl:RUNWAY_PRICING,availability:"READY",limitation:null},
  {id:"h3_max_768",provider:"runway",apiModel:"h3_max",label:"MiniMax H3 Max 768p via Runway",resolution:"768p portrait",expectedCostUsd:.64,minimumCostUsd:.64,sourceUrl:RUNWAY_PRICING,availability:"READY",limitation:null},
  {id:"wan3_720",provider:"runway",apiModel:"wan3",label:"WAN 3.0 720p via Runway",resolution:"720x1280",expectedCostUsd:.80,minimumCostUsd:.80,sourceUrl:RUNWAY_PRICING,availability:"READY",limitation:null},
  {id:"hailuo3_768",provider:"runway",apiModel:"hailuo3",label:"Hailuo 3.0 768p via Runway",resolution:"768p portrait",expectedCostUsd:.82,minimumCostUsd:.82,sourceUrl:RUNWAY_PRICING,availability:"READY",limitation:null},
  {id:"gen4.5",provider:"runway",apiModel:"gen4.5",label:"Runway Gen-4.5",resolution:"720x1280",expectedCostUsd:.96,minimumCostUsd:.96,sourceUrl:RUNWAY_PRICING,availability:"READY",limitation:null},
] as const;

export const STAGE_A_CANDIDATES:BenchmarkModel[]=["google_flow_manual"];
export const STAGE_B_CANDIDATES:BenchmarkModel[]=["veo_3_1_lite"];
export const STAGE_C_CANDIDATES:BenchmarkModel[]=["fal_wan_2_2_turbo","pixverse_v6","gen4_turbo"];
export const STAGE_ONE_CANDIDATES:BenchmarkModel[]=["fal_wan_2_2_turbo"];

export function selectCandidates(ids:BenchmarkModel[]){
  const wanted=new Set(ids),selected=BENCHMARK_CANDIDATES.filter(candidate=>wanted.has(candidate.id));
  if(selected.length!==wanted.size)throw new Error("Unknown benchmark candidate");
  return selected;
}
export function forecastCost(candidates:readonly BenchmarkCandidate[],fixtureCount:number,repeats:number){return Number((candidates.reduce((sum,item)=>sum+item.expectedCostUsd,0)*fixtureCount*repeats).toFixed(4))}
export function minimumForecastCost(candidates:readonly BenchmarkCandidate[],fixtureCount:number,repeats:number){return Number((candidates.reduce((sum,item)=>sum+item.minimumCostUsd,0)*fixtureCount*repeats).toFixed(4))}
