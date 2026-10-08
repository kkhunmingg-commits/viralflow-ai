import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
const boundary=vi.hoisted(()=>({execute:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("node:child_process",()=>{
  const execute=Object.assign(()=>{}, {[promisify.custom]:boundary.execute});return{execFile:execute};
});
import { inspectLocalMedia } from "./media-local";
const bytes=new Uint8Array([1,2,3]),hash=createHash("sha256").update(bytes).digest("hex");
const output=()=>({stdout:JSON.stringify({schemaVersion:1,assetHash:hash,durationSeconds:8,coverageComplete:false,
  evidenceVerified:false,frames:[{timeSeconds:0,text:"",confidence:0,comparisonCandidate:false,contrast:0,sharpness:0}],
  audioStatus:"UNAVAILABLE",uncertainties:["SAMPLED_FRAMES_ONLY","VISUAL_SEMANTICS_UNVERIFIED","AUDIO_UNVERIFIED"]}),stderr:""});
describe("bounded server-only media process",()=>{
  beforeEach(()=>{vi.stubEnv("COMPLIANCE_LOCAL_MEDIA_ENABLED","true");boundary.execute.mockReset().mockResolvedValue(output());});
  afterEach(()=>vi.unstubAllEnvs());
  it("disabled scanner cannot execute a decoder or read secrets",async()=>{
    vi.stubEnv("COMPLIANCE_LOCAL_MEDIA_ENABLED","false");expect(await inspectLocalMedia(bytes)).toEqual({state:"DISABLED"});
    expect(boundary.execute).not.toHaveBeenCalled();
  });
  it("isolates credentials, bounds execution, checks the hash and removes temporary input",async()=>{
    vi.stubEnv("FAL_KEY","do-not-inherit");vi.stubEnv("SUPABASE_SECRET_KEY","do-not-inherit");
    expect((await inspectLocalMedia(bytes)).state).toBe("OBSERVED");
    const [,args,options]=boundary.execute.mock.calls[0];
    expect(options).toMatchObject({shell:false,windowsHide:true,timeout:120_000,maxBuffer:1_000_000});
    expect(options.env.FAL_KEY).toBeUndefined();expect(options.env.SUPABASE_SECRET_KEY).toBeUndefined();
    expect(options.env.NODE_OPTIONS).toBeUndefined();expect(existsSync(path.dirname(args.at(-1)))).toBe(false);
  });
  it.each(["timeout","malformed","wrong-asset"])("%s fails closed, releases capacity and cleans temporary data",async(kind)=>{
    if(kind==="timeout")boundary.execute.mockRejectedValueOnce(new Error("private decoder diagnostics"));
    if(kind==="malformed")boundary.execute.mockResolvedValueOnce({stdout:"bad data"});
    if(kind==="wrong-asset")boundary.execute.mockResolvedValueOnce({stdout:output().stdout.replace(hash,"b".repeat(64))});
    expect(await inspectLocalMedia(bytes)).toEqual({state:"FAILED"});
    const args=boundary.execute.mock.calls[0][1];expect(existsSync(path.dirname(args.at(-1)))).toBe(false);
    expect((await inspectLocalMedia(bytes)).state).toBe("OBSERVED");
  });
  it("does not queue another decoder during a slow request",async()=>{
    let resolve!: (value:ReturnType<typeof output>)=>void;
    boundary.execute.mockReturnValueOnce(new Promise(accept=>{resolve=accept}));
    const first=inspectLocalMedia(bytes);while(!resolve)await new Promise(accept=>setTimeout(accept,1));
    expect(await inspectLocalMedia(bytes)).toEqual({state:"FAILED"});
    resolve(output());expect((await first).state).toBe("OBSERVED");expect(boundary.execute).toHaveBeenCalledTimes(1);
  });
});
