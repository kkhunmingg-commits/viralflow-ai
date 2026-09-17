import type {BenchmarkCandidate,BenchmarkModel} from "./types";

const RUNWAY_PRICING="https://docs.dev.runwayml.com/guides/pricing/";
export const BENCHMARK_CANDIDATES:readonly BenchmarkCandidate[]=[
  {id:"gen4_turbo",provider:"runway",apiModel:"gen4_turbo",label:"Runway Gen-4 Turbo",resolution:"720x1280",expectedCostUsd:.40,sourceUrl:RUNWAY_PRICING},
  {id:"h3_max_768",provider:"runway",apiModel:"h3_max",label:"MiniMax H3 Max 768p via Runway",resolution:"768p portrait",expectedCostUsd:.64,sourceUrl:RUNWAY_PRICING},
  {id:"wan3_720",provider:"runway",apiModel:"wan3",label:"WAN 3.0 720p via Runway",resolution:"720x1280",expectedCostUsd:.80,sourceUrl:RUNWAY_PRICING},
  {id:"hailuo3_768",provider:"runway",apiModel:"hailuo3",label:"Hailuo 3.0 768p via Runway",resolution:"768p portrait",expectedCostUsd:.82,sourceUrl:RUNWAY_PRICING},
  {id:"gen4.5",provider:"runway",apiModel:"gen4.5",label:"Runway Gen-4.5",resolution:"720x1280",expectedCostUsd:.96,sourceUrl:RUNWAY_PRICING},
] as const;

export function selectCandidates(ids:BenchmarkModel[]){
  const wanted=new Set(ids),selected=BENCHMARK_CANDIDATES.filter(candidate=>wanted.has(candidate.id));
  if(selected.length!==wanted.size)throw new Error("Unknown benchmark candidate");
  return selected;
}
export function forecastCost(candidates:readonly BenchmarkCandidate[],fixtureCount:number,repeats:number){return Number((candidates.reduce((sum,item)=>sum+item.expectedCostUsd,0)*fixtureCount*repeats).toFixed(4))}
