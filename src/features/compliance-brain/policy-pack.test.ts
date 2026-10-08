import {generateKeyPairSync} from "node:crypto";
import {describe,expect,it} from "vitest";
import {policySourceHash} from "./policy-ingestion";
import {canonicalPolicyJson,policyPackChecksum,signPolicyPack,validatePolicyPackPayload,verifySignedPolicyPack} from "./policy-pack";
import type {PolicyPackPayload} from "./policy-registry";

const now=new Date("2026-10-07T01:00:00Z");
const key=generateKeyPairSync("ed25519");
const trusted={admin:key.publicKey};
function payload():PolicyPackPayload {
  return{schemaVersion:1,id:"tiktok.th",version:"2026.10.07.1",platform:"TIKTOK_SHOP",country:"TH",region:"TH",
    effectiveDate:"UNKNOWN",issuedAt:now.toISOString(),sources:[{
      id:"medical",url:"https://seller-th.tiktok.com/university/essay?knowledge_id=10008418&lang=en",title:"Official policy fixture",
      platform:"TIKTOK_SHOP",country:"TH",region:"TH",sourceHash:policySourceHash("Products must not invent medical effects."),hashBasis:"NORMALIZED_TEXT_V1",
      retrievedAt:now.toISOString(),publishedAt:"2026-03-16",effectiveDate:"UNKNOWN",version:"2026.10.07",contentTypes:["POST","LIVE"],categories:["GENERAL"],
    }],rules:[{id:"medical.claim",version:"1",sourceIds:["medical"],semanticCategories:["MEDICAL_TREATMENT"],
      obligation:"Do not invent medical treatment effects for a product.",severity:"CRITICAL",recommendedDecision:"BLOCK",contentTypes:["POST","LIVE"],categories:["GENERAL"],requiresEvidence:true}]};
}
const signed=()=>signPolicyPack(payload(),"admin",key.privateKey,{now});

describe("signed policy packs",()=>{
  it("verifies an Ed25519 envelope and does not expose a mutable payload reference",()=>{
    const pack=signed(),verified=verifySignedPolicyPack(pack,trusted,{now});
    expect(verified).toEqual(payload());verified.rules[0].obligation="Changed after verification";
    expect(pack.payload.rules[0].obligation).toBe(payload().rules[0].obligation);
  });
  it("uses stable canonical keys and binds the envelope metadata",()=>{
    expect(canonicalPolicyJson({b:1,a:["x",true]})).toBe('{"a":["x",true],"b":1}');
    const pack=signed();pack.keyId="second";
    expect(()=>verifySignedPolicyPack(pack,{second:key.publicKey},{now})).toThrow("POLICY_SIGNATURE_INVALID");
  });
  it("rejects tampered obligations even when the attacker recomputes the checksum",()=>{
    const pack=signed();pack.payload.rules[0].recommendedDecision="PASS_WITH_WARNING";pack.checksum=policyPackChecksum(pack.payload);
    expect(()=>verifySignedPolicyPack(pack,trusted,{now})).toThrow("POLICY_SIGNATURE_INVALID");
  });
  it("rejects a changed payload with the original checksum",()=>{
    const pack=signed();pack.payload.version="changed";
    expect(()=>verifySignedPolicyPack(pack,trusted,{now})).toThrow("POLICY_CHECKSUM_MISMATCH");
  });
  it("rejects untrusted and inherited key names",()=>{
    expect(()=>verifySignedPolicyPack(signed(),{},{now})).toThrow("POLICY_SIGNER_UNTRUSTED");
    const pack=signed();pack.keyId="toString";
    expect(()=>verifySignedPolicyPack(pack,{}, {now})).toThrow("POLICY_SIGNER_UNTRUSTED");
  });
  it("rejects a signature from a different private key",()=>{
    const other=generateKeyPairSync("ed25519"),pack=signPolicyPack(payload(),"admin",other.privateKey,{now});
    expect(()=>verifySignedPolicyPack(pack,trusted,{now})).toThrow("POLICY_SIGNATURE_INVALID");
  });
  it("rejects non-Ed25519 signing and verification keys",()=>{
    const rsa=generateKeyPairSync("rsa",{modulusLength:2048});
    expect(()=>signPolicyPack(payload(),"admin",rsa.privateKey,{now})).toThrow("POLICY_SIGNING_KEY_INVALID");
    expect(()=>verifySignedPolicyPack(signed(),{admin:rsa.publicKey},{now})).toThrow("POLICY_VERIFICATION_KEY_INVALID");
  });
  it.each(["", "invalid", "a".repeat(100)])("rejects malformed signatures %s",signature=>{
    const pack=signed();pack.signature=signature;
    expect(()=>verifySignedPolicyPack(pack,trusted,{now})).toThrow("POLICY_SIGNATURE_INVALID");
  });
  it("accepts UNKNOWN only when deployment policy permits it",()=>{
    expect(()=>verifySignedPolicyPack(signed(),trusted,{now,allowUnknownEffectiveDate:false})).toThrow("POLICY_EFFECTIVE_DATE_UNKNOWN");
  });
  it("rejects future pack and future individual source effective dates",()=>{
    const future=payload();future.effectiveDate="2026-10-08";
    expect(()=>validatePolicyPackPayload(future,{now})).toThrow("POLICY_NOT_EFFECTIVE");
    future.effectiveDate="UNKNOWN";future.sources[0].effectiveDate="2026-10-08";
    expect(()=>validatePolicyPackPayload(future,{now})).toThrow("POLICY_NOT_EFFECTIVE");
  });
  it("rejects impossible dates, future issuance, duplicate IDs and extra executable fields",()=>{
    const invalid=payload();invalid.sources[0].publishedAt="2026-02-31";
    expect(()=>validatePolicyPackPayload(invalid,{now})).toThrow();
    invalid.sources[0].publishedAt="UNKNOWN";invalid.issuedAt="2026-10-08T00:00:00Z";
    expect(()=>validatePolicyPackPayload(invalid,{now})).toThrow("POLICY_ISSUED_IN_FUTURE");
    invalid.issuedAt=now.toISOString();invalid.rules.push({...invalid.rules[0]});
    expect(()=>validatePolicyPackPayload(invalid,{now})).toThrow("POLICY_IDS_DUPLICATED");
    expect(()=>validatePolicyPackPayload({...payload(),execute:"alert(1)"},{now})).toThrow();
  });
  it("rejects unknown semantic categories and missing source references",()=>{
    const invalid=payload();invalid.rules[0].semanticCategories=["UNREVIEWED_CATEGORY"];
    expect(()=>validatePolicyPackPayload(invalid,{now})).toThrow("POLICY_SEMANTIC_CATEGORY_UNKNOWN");
    invalid.rules[0].semanticCategories=["MEDICAL_TREATMENT"];invalid.rules[0].sourceIds=["missing"];
    expect(()=>validatePolicyPackPayload(invalid,{now})).toThrow("POLICY_RULE_SOURCE_MISSING");
  });
  it("rejects platform, channel and category scope expansion",()=>{
    const invalid=payload();invalid.sources[0].country="SG";
    expect(()=>validatePolicyPackPayload(invalid,{now})).toThrow("POLICY_SCOPE_MISMATCH");
    invalid.sources[0].country="TH";invalid.sources[0].contentTypes=["POST"];
    expect(()=>validatePolicyPackPayload(invalid,{now})).toThrow("POLICY_CHANNEL_SCOPE_MISMATCH");
    invalid.sources[0].contentTypes=["POST","LIVE"];invalid.sources[0].categories=["BEAUTY"];
    expect(()=>validatePolicyPackPayload(invalid,{now})).toThrow("POLICY_CATEGORY_SCOPE_MISMATCH");
  });
  it("rejects unsigned, empty and nonofficial source packs",()=>{
    expect(()=>verifySignedPolicyPack(payload(),trusted,{now})).toThrow();
    expect(()=>validatePolicyPackPayload({...payload(),rules:[]},{now})).toThrow();
    const invalid=payload();invalid.sources[0].url="https://seller-th.tiktok.com.evil.invalid/university/essay?knowledge_id=1";
    expect(()=>validatePolicyPackPayload(invalid,{now})).toThrow();
  });
});
