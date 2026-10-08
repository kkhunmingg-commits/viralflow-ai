import {generateKeyPairSync} from "node:crypto";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,describe,expect,it,vi} from "vitest";
import {FilePolicyRegistryStore} from "./policy-file-store";
import {createPolicySourceSnapshot} from "./policy-ingestion";
import {signPolicyPack,type SignedPolicyPack} from "./policy-pack";
import {MemoryPolicyRegistryStore,PolicyRegistry,policyPackKey,policyScopeKey,type PolicyPackPayload,type PolicyRegistryStore,type PolicyRule} from "./policy-registry";

const now=new Date("2026-10-07T01:00:00Z"),key=generateKeyPairSync("ed25519"),scope={platform:"TIKTOK_SHOP",country:"TH",region:"TH"};
const authorization={actorId:"trusted-admin",approvalId:"review.123"};
const validation={regressionReportHash:"a".repeat(64),regressionPassed:12,regressionFailed:0,unknownEffectiveDateAcknowledged:true};
function fixture(version="1"){
  const snapshot=createPolicySourceSnapshot({...scope,id:"official.claims",url:"https://seller-th.tiktok.com/university/essay?knowledge_id=10008418&lang=en",
    title:"Policy test fixture",retrievedAt:now.toISOString(),effectiveDate:"UNKNOWN",version,contentTypes:["POST","LIVE"],categories:["GENERAL"]},`Official text version ${version}: do not invent medical treatment benefits.`);
  const rule:PolicyRule={id:"claim.medical",version,sourceIds:[snapshot.source.id],semanticCategories:["MEDICAL_TREATMENT"],obligation:`Version ${version}: do not invent medical treatment benefits.`,
    severity:"CRITICAL",recommendedDecision:"BLOCK",contentTypes:["POST","LIVE"],categories:["GENERAL"],requiresEvidence:true};
  const payload:PolicyPackPayload={...scope,schemaVersion:1,id:"tiktok.th",version,effectiveDate:"UNKNOWN",issuedAt:now.toISOString(),sources:[snapshot.source],rules:[rule]};
  return{...snapshot,rule,payload,pack:signPolicyPack(payload,"admin",key.privateKey,{now})};
}
function registry(store:PolicyRegistryStore=new MemoryPolicyRegistryStore(),authorized=true){return{store,registry:new PolicyRegistry(store,{admin:key.publicKey},async()=>authorized,{now})}}
async function parsed(registry:PolicyRegistry,version="1"){
  const data=fixture(version),candidate=await registry.discover(data.source,data.text);
  await registry.parseCandidate(candidate.id,[data.rule],"AI",[data.rule.obligation]);return{...data,candidate};
}
async function approved(registry:PolicyRegistry,version="1"){
  const data=await parsed(registry,version);await registry.validateCandidate(data.candidate.id,validation,authorization);return data;
}
const directories:string[]=[];
afterEach(async()=>{for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true})});

describe("policy registry lifecycle",()=>{
  it("starts without an active pack and does not manufacture a safe policy",async()=>{
    expect(await registry().registry.loadActive(scope)).toEqual({pack:null,source:"NONE",errorCodes:["POLICY_PACK_UNAVAILABLE"]});
  });
  it("keeps AI-parsed candidates pending and denies activation before review",async()=>{
    const {registry:r}=registry(),data=await parsed(r);
    expect((await r.listCandidates())[0]).toMatchObject({status:"PARSED",parserOrigin:"AI",validation:null});
    await expect(r.activateSignedPack(data.pack,authorization)).rejects.toThrow("POLICY_CANDIDATE_NOT_VALIDATED");
    expect((await r.loadActive(scope)).pack).toBeNull();
  });
  it("requires server authority, regression success and explicit unknown-date acknowledgement",async()=>{
    const denied=registry(undefined,false),candidate=await parsed(denied.registry);
    await expect(denied.registry.validateCandidate(candidate.candidate.id,validation,authorization)).rejects.toThrow("POLICY_ADMIN_REQUIRED");
    const {registry:r}=registry(),data=await parsed(r);
    await expect(r.validateCandidate(data.candidate.id,{...validation,regressionFailed:1},authorization)).rejects.toThrow("POLICY_REGRESSION_REQUIRED");
    await expect(r.validateCandidate(data.candidate.id,{...validation,regressionPassed:0},authorization)).rejects.toThrow("POLICY_REGRESSION_REQUIRED");
    await expect(r.validateCandidate(data.candidate.id,{...validation,unknownEffectiveDateAcknowledged:false},authorization)).rejects.toThrow("POLICY_EFFECTIVE_DATE_UNKNOWN");
  });
  it("rejects invalid lifecycle jumps and duplicate discoveries do not reset review",async()=>{
    const {registry:r}=registry(),data=fixture(),candidate=await r.discover(data.source,data.text);
    await expect(r.validateCandidate(candidate.id,validation,authorization)).rejects.toThrow("POLICY_TRANSITION_INVALID");
    await r.parseCandidate(candidate.id,[data.rule],"HUMAN");
    expect((await r.discover(data.source,data.text)).status).toBe("PARSED");
    await expect(r.parseCandidate(candidate.id,[data.rule],"AI")).rejects.toThrow("POLICY_TRANSITION_INVALID");
  });
  it("rejects source tampering and unknown semantic categories during review",async()=>{
    const {registry:r,store}=registry(),data=fixture();
    await expect(r.discover(data.source,`${data.text} altered`)).rejects.toThrow("POLICY_SOURCE_INVALID");
    const candidate=await r.discover(data.source,data.text);await r.parseCandidate(candidate.id,[{...data.rule,semanticCategories:["UNKNOWN"]}],"AI");
    await expect(r.validateCandidate(candidate.id,validation,authorization)).rejects.toThrow("POLICY_SEMANTIC_CATEGORY_UNKNOWN");
    const state=await store.readState();state.candidates[0].sourceText="tampered stored article";await store.writeState(state);
    await expect(r.validateCandidate(candidate.id,validation,authorization)).rejects.toThrow("POLICY_SOURCE_HASH_MISMATCH");
  });
  it("activates an approved signed pack and reads it through the shared resolver",async()=>{
    const {registry:r}=registry(),data=await approved(r);await r.activateSignedPack(data.pack,authorization);
    expect(await r.loadActive(scope)).toEqual({pack:data.payload,source:"ACTIVE",errorCodes:[]});
    expect((await r.listCandidates())[0]).toMatchObject({status:"ACTIVE",validation:{approvedBy:"trusted-admin",regressionFailed:0}});
  });
  it("rejects source metadata and rule changes that were not approved",async()=>{
    const {registry:r}=registry(),data=await approved(r),modified=structuredClone(data.payload);
    modified.sources[0].title="Unreviewed source metadata";
    await expect(r.activateSignedPack(signPolicyPack(modified,"admin",key.privateKey,{now}),authorization)).rejects.toThrow("POLICY_SOURCE_NOT_VALIDATED");
    modified.sources[0]=data.source;modified.rules[0].recommendedDecision="PASS_WITH_WARNING";
    await expect(r.activateSignedPack(signPolicyPack(modified,"admin",key.privateKey,{now}),authorization)).rejects.toThrow("POLICY_RULE_NOT_VALIDATED");
  });
  it("supports data updates without app releases, retires old candidates and rolls back",async()=>{
    const {registry:r}=registry(),first=await approved(r);await r.activateSignedPack(first.pack,authorization);
    const second=await approved(r,"2");await r.activateSignedPack(second.pack,authorization);
    expect((await r.loadActive(scope)).pack?.version).toBe("2");expect((await r.listCandidates()).map(row=>row.status)).toEqual(["RETIRED","ACTIVE"]);
    await r.rollback(scope,policyPackKey(first.payload),authorization);
    expect((await r.loadActive(scope)).pack?.version).toBe("1");
    await expect(r.rollback({...scope,country:"SG"},policyPackKey(first.payload),authorization)).rejects.toThrow("POLICY_ROLLBACK_TARGET_INVALID");
  });
  it("makes pack ID/version immutable after activation",async()=>{
    const {registry:r}=registry(),first=await approved(r);await r.activateSignedPack(first.pack,authorization);
    const next=await approved(r,"2");next.payload.version="1";
    await expect(r.activateSignedPack(signPolicyPack(next.payload,"admin",key.privateKey,{now}),authorization)).rejects.toThrow("POLICY_VERSION_IMMUTABLE");
  });
  it("falls back to the previously verified pack after a damaged active update",async()=>{
    const {registry:r,store}=registry(),data=await approved(r);await r.activateSignedPack(data.pack,authorization);
    const state=await store.readState();state.packs[policyPackKey(data.payload)].signature="corrupt";await store.writeState(state);
    expect(await r.loadActive(scope)).toEqual({pack:data.payload,source:"LAST_KNOWN_GOOD",errorCodes:["POLICY_SIGNATURE_INVALID"]});
  });
  it("does not accept invalid LKG signatures or a newly revoked signer",async()=>{
    const {registry:r,store}=registry(),data=await approved(r);await r.activateSignedPack(data.pack,authorization);
    expect((await new PolicyRegistry(store,{},undefined,{now}).loadActive(scope)).pack).toBeNull();
    const bad={...data.pack,signature:"bad"};await store.writeLastKnownGood(policyScopeKey(scope),bad);
    const state=await store.readState();state.active={};await store.writeState(state);
    expect((await r.loadActive(scope)).pack).toBeNull();
  });
  it("does not publish a failed state commit through the fallback",async()=>{
    const {registry:r,store}=registry(),data=await approved(r);
    vi.spyOn(store,"writeState").mockRejectedValueOnce(new Error("disk failed"));
    await expect(r.activateSignedPack(data.pack,authorization)).rejects.toThrow("disk failed");
    expect(await store.readLastKnownGood(policyScopeKey(scope))).toBeNull();
  });
  it("explicit admin disable overrides fallback and retires rules",async()=>{
    const {registry:r,store}=registry(),data=await approved(r);await r.activateSignedPack(data.pack,authorization);await r.deactivate(scope,authorization);
    expect(await r.loadActive(scope)).toEqual({pack:null,source:"NONE",errorCodes:["POLICY_ADMIN_DISABLED"]});
    expect(await store.readLastKnownGood(policyScopeKey(scope))).toBeNull();
    expect((await r.listCandidates())[0].status).toBe("RETIRED");
  });
  it("serializes mutations shared by multiple registry instances",async()=>{
    const store=new MemoryPolicyRegistryStore(),a=registry(store).registry,b=registry(store).registry,first=fixture("1"),second=fixture("2");
    await Promise.all([a.discover(first.source,first.text),b.discover(second.source,second.text)]);
    expect(await a.listCandidates()).toHaveLength(2);
  });
});

describe("durable policy registry store",()=>{
  it("recovers an offline LKG after restart and corrupt state, with no provider calls",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"policy-registry-"));directories.push(directory);
    const store=new FilePolicyRegistryStore(directory),r=registry(store).registry,data=await approved(r);await r.activateSignedPack(data.pack,authorization);
    await writeFile(join(directory,"registry.json"),"corrupt primary state","utf8");
    const afterRestart=registry(new FilePolicyRegistryStore(directory)).registry;
    expect((await afterRestart.loadActive(scope))).toMatchObject({pack:data.payload,source:"LAST_KNOWN_GOOD"});
    expect(await readFile(join(directory,"registry.json"),"utf8")).toBe("corrupt primary state");
  });
  it("persists disable independently of primary state corruption",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"policy-disabled-"));directories.push(directory);
    const r=registry(new FilePolicyRegistryStore(directory)).registry,data=await approved(r);await r.activateSignedPack(data.pack,authorization);await r.deactivate(scope,authorization);
    await writeFile(join(directory,"registry.json"),"corrupt primary state","utf8");
    expect((await registry(new FilePolicyRegistryStore(directory)).registry.loadActive(scope)).pack).toBeNull();
  });
  it("fails safely on a held interprocess lock instead of deleting a live lock",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"policy-locked-"));directories.push(directory);
    await writeFile(join(directory,".registry.lock"),"other process","utf8");
    await expect(new FilePolicyRegistryStore(directory,0).withMutationLock(async()=>"unsafe")).rejects.toThrow("POLICY_STORE_LOCKED");
    expect(await readFile(join(directory,".registry.lock"),"utf8")).toBe("other process");
  });
  it("stores the full signed envelope, rather than an unsigned payload",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"policy-envelope-"));directories.push(directory);
    const store=new FilePolicyRegistryStore(directory),data=fixture();await store.writeLastKnownGood(policyScopeKey(scope),data.pack);
    const pack:SignedPolicyPack|null=await new FilePolicyRegistryStore(directory).readLastKnownGood(policyScopeKey(scope));expect(pack).toEqual(data.pack);
  });
});
