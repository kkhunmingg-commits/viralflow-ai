import {existsSync} from "node:fs";
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {z} from "zod";
import {BENCHMARK_CANDIDATES,selectCandidates} from "../src/features/video-benchmark/catalog";
import {applyHumanScores,chooseWinner,rankCandidates} from "../src/features/video-benchmark/rubric";
import {runVideoProviderBenchmark} from "../src/features/video-benchmark/runner";
import type {BenchmarkFixture,BenchmarkModel,BenchmarkReport,HumanScores} from "../src/features/video-benchmark/types";

if(existsSync(".env.local"))process.loadEnvFile(".env.local");
const args=process.argv.slice(2),value=(flag:string)=>{const index=args.indexOf(flag);return index>=0?args[index+1]:undefined},execute=args.includes("--execute"),resume=args.includes("--resume"),manifestPath=value("--manifest"),scoresPath=value("--scores"),reportPath=resolve(value("--report")??".video-benchmark/report.json"),outputDir=resolve(value("--output")??".video-benchmark/outputs"),repeats=Number(value("--repeats")??2),modelIds=(value("--models")?.split(",")??BENCHMARK_CANDIDATES.map(item=>item.id)) as BenchmarkModel[];
const humanScore=z.object({productIdentity:z.number().min(0).max(100),motionRealism:z.number().min(0).max(100),promptAdherence:z.number().min(0).max(100),commerceClarity:z.number().min(0).max(100),artifactControl:z.number().min(0).max(100),visualPolish:z.number().min(0).max(100)});
async function json(path:string){return JSON.parse(await readFile(resolve(path),"utf8")) as unknown}
async function main(){
  if(scoresPath){const report=await json(reportPath) as BenchmarkReport,scores=z.record(z.string(),humanScore).parse(await json(scoresPath)) as Record<string,HumanScores>,samples=applyHumanScores(report.samples,scores),ranking=rankCandidates(samples),choice=chooseWinner(ranking),updated={...report,samples,ranking,winner:choice.winner,winnerReason:choice.reason};await writeFile(reportPath,JSON.stringify(updated,null,2));console.log(JSON.stringify({report:reportPath,winner:updated.winner,reason:updated.winnerReason}));return}
  if(!manifestPath)throw new Error("Use --manifest <licensed-fixtures.json>; the repository intentionally contains no fabricated product benchmark media");
  const fixtures=z.array(z.object({id:z.string().min(1),label:z.string().min(1),imagePath:z.string().min(1),prompt:z.string().min(10),renderInput:z.object({productTitle:z.string(),hook:z.string(),cta:z.string(),template:z.string(),overlay:z.array(z.object({start:z.number(),end:z.number(),text:z.string()})),scenes:z.array(z.object({start:z.number(),end:z.number(),visual:z.string(),motion:z.string()}))})})).min(3).parse(await json(manifestPath)) as BenchmarkFixture[];
  const allowPaid=process.env.VIDEO_BENCHMARK_ALLOW_PAID==="true",budgetCap=Number(process.env.VIDEO_BENCHMARK_MAX_USD??0);if(execute&&!allowPaid)throw new Error("Set VIDEO_BENCHMARK_ALLOW_PAID=true for an intentional paid run");if(execute&&(!Number.isFinite(budgetCap)||budgetCap<=0))throw new Error("Set a positive VIDEO_BENCHMARK_MAX_USD hard cap");if(execute&&existsSync(reportPath)&&!resume)throw new Error("A report already exists; use --resume to reuse completed samples instead of paying twice");const prior=resume&&existsSync(reportPath)?await json(reportPath) as BenchmarkReport:undefined;
  const report=await runVideoProviderBenchmark({candidates:selectCandidates(modelIds),fixtures,repeats,execute,budgetCapUsd:execute?budgetCap:0,apiKey:process.env.RUNWAYML_API_SECRET,outputDir,resumeSamples:prior?.samples});await writeFile(reportPath,JSON.stringify(report,null,2),{encoding:"utf8",flag:"w"});console.log(JSON.stringify({report:reportPath,execute,forecastCostUsd:report.forecastCostUsd,samples:report.samples.length,winner:report.winner,reason:report.winnerReason}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Benchmark failed");process.exitCode=1});
