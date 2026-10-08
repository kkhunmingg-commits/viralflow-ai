/** Test data only. No fixture key, rule or pack is trusted by the production runtime. */
import {generateKeyPairSync} from "node:crypto";
import {SEMANTIC_CATEGORIES,type SemanticCategory} from "./contracts";
import {policySourceHash} from "./policy-ingestion";
import {signPolicyPack,verifySignedPolicyPack} from "./policy-pack";
import type {PolicyPackPayload,PolicyScope} from "./policy-registry";

export const POLICY_TEST_NOW="2026-10-07T01:00:00Z";
const prohibitions=new Set<SemanticCategory>(["MEDICAL_TREATMENT","DISEASE_PREVENTION","DIAGNOSIS","REPLACEMENT_FOR_MEDICAL_CARE",
  "GUARANTEED_RESULT","FALSE_BEFORE_AFTER","BODY_MANIPULATION","RESTRICTED_PRODUCT","EXAGGERATED_FUNCTIONALITY"]);
export function createPolicyTestPayload(scope:PolicyScope={platform:"TIKTOK_SHOP",country:"TH",region:"TH"}):PolicyPackPayload {
  return{...scope,schemaVersion:1,id:"test.only",version:"fixture.1",effectiveDate:"UNKNOWN",issuedAt:POLICY_TEST_NOW,sources:[{
    ...scope,id:"test.official",url:"https://seller-th.tiktok.com/university/essay?knowledge_id=10008418&lang=en",
    title:"Synthetic regression fixture; not researched production policy",sourceHash:policySourceHash("Synthetic policy regression fixture text for isolated unit tests."),
    hashBasis:"NORMALIZED_TEXT_V1",retrievedAt:POLICY_TEST_NOW,effectiveDate:"UNKNOWN",version:"fixture.1",contentTypes:["POST","LIVE"],categories:["*"],
  }],rules:SEMANTIC_CATEGORIES.map(category=>({id:`fixture.${category}`,version:"1",sourceIds:["test.official"],semanticCategories:[category],
    obligation:`Synthetic regression obligation for ${category}; never activate as production policy.`,
    severity:prohibitions.has(category)?"CRITICAL":"HIGH",recommendedDecision:prohibitions.has(category)?"BLOCK":"REVIEW_REQUIRED",
    contentTypes:["POST","LIVE"],categories:["*"],requiresEvidence:!prohibitions.has(category),
  }))};
}
/** Every call creates an in-memory signer; the public key is returned only to the unit test. */
export function createSignedPolicyTestFixture(scope?:PolicyScope){
  const keys=generateKeyPairSync("ed25519"),trustedKeys={"fixture.ephemeral":keys.publicKey};
  const signed=signPolicyPack(createPolicyTestPayload(scope),"fixture.ephemeral",keys.privateKey,{now:new Date(POLICY_TEST_NOW)});
  return{signed,trustedKeys,payload:verifySignedPolicyPack(signed,trustedKeys,{now:new Date(POLICY_TEST_NOW)})};
}
