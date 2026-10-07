import {createHash} from "node:crypto";
import {mkdir, readFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {join} from "node:path";
import {evaluateCommerce, type CommerceScores} from "./commerce-rubric";
import {preparePortraitProductReference} from "./provider-normalization";
import type {BenchmarkFixture, BenchmarkModel, BenchmarkSample} from "./types";

/** Staged comparison is the default; a separately authorized matrix retains the runner's hard cap and one-attempt guard. */
export function selectFalStageFixtures(input:{fixtures:BenchmarkFixture[];allFixtures:boolean;execute:boolean;matrix?:boolean;models:BenchmarkModel[];priorSamples?:BenchmarkSample[];reviews?:Record<string,CommerceScores>}){
  if(!input.fixtures.length)throw new Error("A product reference is required");
  if(input.matrix){
    if(input.fixtures.length<3)throw new Error("A product matrix requires at least three shared product references");
    return input.fixtures;
  }
  const first=input.fixtures[0];
  if(!input.allFixtures)return[first];
  if(input.execute){
    for(const model of input.models){
      const sample=input.priorSamples?.find(row=>row.candidateId===model&&row.fixtureId===first.id&&row.repeat===1);
      const review=sample&&input.reviews?.[sample.id];
      if(!sample||sample.status!=="COMPLETED"||sample.sourceKind!=="PROVIDER_API"||!sample.technical?.passed||!review||!evaluateCommerce(review).passed){
        throw new Error("Additional products require a passing technical and commercial review of each model's first sample");
      }
    }
  }
  return input.fixtures;
}

/** Hash-addressed copies keep the same portrait input across all models and safe resumes. */
export async function prepareFalStageReferences(fixtures:BenchmarkFixture[],outputDir:string){
  const referenceDir=join(outputDir,"references");
  await mkdir(referenceDir,{recursive:true});
  const prepared:BenchmarkFixture[]=[];
  for(const fixture of fixtures){
    const hash=createHash("sha256").update(await readFile(fixture.imagePath)).digest("hex");
    const imagePath=join(referenceDir,`${hash}-portrait-v1.jpg`);
    if(!existsSync(imagePath))await preparePortraitProductReference(fixture.imagePath,imagePath);
    prepared.push({...fixture,imagePath});
  }
  return prepared;
}
