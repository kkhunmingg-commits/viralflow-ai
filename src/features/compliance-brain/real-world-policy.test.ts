import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { policyPackChecksum, signPolicyPack, validatePolicyPackPayload, verifySignedPolicyPack } from "./policy-pack";
import { MemoryPolicyRegistryStore, PolicyRegistry } from "./policy-registry";
import { ComplianceEngine } from "./engine";
import { passesCompliance } from "./gates";
import { holdoutInput } from "./holdout-corpus";

const draft=JSON.parse(readFileSync("docs/compliance-brain/tiktok-th-policy-draft-2026-10-09.json","utf8"));
const holdout=JSON.parse(readFileSync("docs/compliance-brain/real-world-holdout.json","utf8")) as {cases:Array<{id:string;text:string;allowed:boolean}>};
const now=new Date("2026-10-09T03:00:00Z");
describe("researched TH draft and independent holdout",()=>{
  it("has official provenance, real publication dates and honest unknown effective dates",()=>{
    const pack=validatePolicyPackPayload(draft.payload,{now});
    expect(pack.sources).toHaveLength(6);expect(draft.checksum).toBe(policyPackChecksum(pack));
    expect(draft.ownerApproval).toBe("PENDING");expect(draft.signature).toBeNull();expect(draft.validation).toBeNull();
    expect(pack.sources.find(row=>row.id==="beauty")?.publishedAt).toBe("2026-09-14");
    expect(()=>validatePolicyPackPayload(pack,{now,allowUnknownEffectiveDate:false})).toThrow("POLICY_EFFECTIVE_DATE_UNKNOWN");
    expect(()=>verifySignedPolicyPack(draft,{}, {now})).toThrow();
  });
  it("an ephemeral test signature cannot bypass owner/admin validation or production activation",async()=>{
    const key=generateKeyPairSync("ed25519"),signed=signPolicyPack(draft.payload,"test-only",key.privateKey,{now});
    const registry=new PolicyRegistry(new MemoryPolicyRegistryStore(),{"test-only":key.publicKey},async()=>true,{now});
    await expect(registry.activateSignedPack(signed,{actorId:"test-admin",approvalId:"test-only"}))
      .rejects.toThrow("POLICY_CANDIDATE_NOT_VALIDATED");
    expect((await registry.loadActive(draft.payload)).pack).toBeNull();
  });
  it.each(holdout.cases)("new case $id is held or allowed according to evidence, for POST and LIVE",async(row)=>{
    const engine=new ComplianceEngine({policy:async()=>draft.payload});
    for(const channel of ["POST","LIVE"] as const){
      for(const field of ["script","caption"] as const){
        const input=holdoutInput(row.text,"SKINCARE",channel,row.allowed?row.text:undefined);input.now=now.toISOString();
        input.content={[field]:row.text};
        expect(passesCompliance(await engine.evaluate(input))).toBe(row.allowed);
        // Removing support cannot turn a product assertion into a verified fact.
        if(row.allowed){input.evidence.forEach(evidence=>evidence.verified=false);expect(passesCompliance(await engine.evaluate(input))).toBe(false);}
      }
    }
  });
});
