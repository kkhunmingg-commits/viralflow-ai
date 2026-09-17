import type {BenchmarkCandidate,BenchmarkModel} from "./types";

const RUNWAY_PRICING="https://docs.dev.runwayml.com/guides/pricing/";
const FAL_WAN="https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video/turbo";
const PIXVERSE_PRICING="https://docs.platform.pixverse.ai/pricing-796039m0";
const TIKTOK_SYMPHONY="https://ads.tiktok.com/creative/creativeCenter/tools/api";
export const BENCHMARK_CANDIDATES:readonly BenchmarkCandidate[]=[
  {id:"fal_wan_2_2_turbo",provider:"fal",apiModel:"fal-ai/wan/v2.2-a14b/image-to-video/turbo",label:"fal Wan 2.2 Turbo",resolution:"720p portrait",expectedCostUsd:.10,minimumCostUsd:.10,sourceUrl:FAL_WAN,availability:"READY",limitation:null},
  {id:"pixverse_v6",provider:"pixverse",apiModel:"v6",label:"PixVerse V6",resolution:"720p portrait",expectedCostUsd:.72,minimumCostUsd:.32,sourceUrl:PIXVERSE_PRICING,availability:"READY",limitation:"Eight seconds uses 72 credits. USD cost varies by PixVerse API credit package; $0.72 is the conservative package-rate forecast."},
  {id:"tiktok_symphony",provider:"tiktok_symphony",apiModel:"symphony-image-to-video",label:"TikTok Symphony API",resolution:"portrait",expectedCostUsd:0,minimumCostUsd:0,sourceUrl:TIKTOK_SYMPHONY,availability:"NOT_RUN",limitation:"No approved Symphony API application, access token, advertiser scope, or public unit price is available in this environment."},
  {id:"gen4_turbo",provider:"runway",apiModel:"gen4_turbo",label:"Runway Gen-4 Turbo",resolution:"720x1280",expectedCostUsd:.40,minimumCostUsd:.40,sourceUrl:RUNWAY_PRICING,availability:"READY",limitation:null},
  {id:"h3_max_768",provider:"runway",apiModel:"h3_max",label:"MiniMax H3 Max 768p via Runway",resolution:"768p portrait",expectedCostUsd:.64,minimumCostUsd:.64,sourceUrl:RUNWAY_PRICING,availability:"READY",limitation:null},
  {id:"wan3_720",provider:"runway",apiModel:"wan3",label:"WAN 3.0 720p via Runway",resolution:"720x1280",expectedCostUsd:.80,minimumCostUsd:.80,sourceUrl:RUNWAY_PRICING,availability:"READY",limitation:null},
  {id:"hailuo3_768",provider:"runway",apiModel:"hailuo3",label:"Hailuo 3.0 768p via Runway",resolution:"768p portrait",expectedCostUsd:.82,minimumCostUsd:.82,sourceUrl:RUNWAY_PRICING,availability:"READY",limitation:null},
  {id:"gen4.5",provider:"runway",apiModel:"gen4.5",label:"Runway Gen-4.5",resolution:"720x1280",expectedCostUsd:.96,minimumCostUsd:.96,sourceUrl:RUNWAY_PRICING,availability:"READY",limitation:null},
] as const;

export const STAGE_ONE_CANDIDATES:BenchmarkModel[]=["fal_wan_2_2_turbo","pixverse_v6","gen4_turbo"];

export function selectCandidates(ids:BenchmarkModel[]){
  const wanted=new Set(ids),selected=BENCHMARK_CANDIDATES.filter(candidate=>wanted.has(candidate.id));
  if(selected.length!==wanted.size)throw new Error("Unknown benchmark candidate");
  return selected;
}
export function forecastCost(candidates:readonly BenchmarkCandidate[],fixtureCount:number,repeats:number){return Number((candidates.reduce((sum,item)=>sum+item.expectedCostUsd,0)*fixtureCount*repeats).toFixed(4))}
export function minimumForecastCost(candidates:readonly BenchmarkCandidate[],fixtureCount:number,repeats:number){return Number((candidates.reduce((sum,item)=>sum+item.minimumCostUsd,0)*fixtureCount*repeats).toFixed(4))}
