import {describe,expect,it,vi} from "vitest";
import {FalWanProviderError,FalWanVideoProvider,generateAcceptedFalWanMaster,type FalWanClient} from "./fal-wan";
import type {RenderedVideo,VideoQualityInput} from "./types";
import {falAutoModeAvailability} from "./provider-routing";
import {createFalClient} from "@fal-ai/client";
import {FAL_MODEL_ENDPOINTS, resolveFalModelSettings} from "./fal-models";

vi.mock("@fal-ai/client", () => ({createFalClient: vi.fn(() => ({storage: {upload: vi.fn(async () => "https://example.invalid/input.jpg")}}))}));

const key="fal-test-key-never-log-123456789",videoBytes=new Uint8Array([0,1,2,3]),videoUrl="https://v3b.fal.media/video.mp4";
function client(statuses:Array<{status?:string;error?:unknown;error_type?:string}>=[{status:"COMPLETED"}],result:{data:{video:{url?:string}};requestId:string}={data:{video:{url:videoUrl}},requestId:"req-1"}){const submit=vi.fn(async(_endpoint:string,_input:Record<string,unknown>)=>({request_id:"req-1"})),status=vi.fn(async(_endpoint:string,_requestId:string)=>statuses.shift()??{status:"COMPLETED"}),getResult=vi.fn(async(_endpoint:string,_requestId:string)=>result);return{value:{upload:vi.fn(async(_file:Blob)=>"https://example.invalid/input.jpg"),submit,status,result:getResult} satisfies FalWanClient,submit,status,getResult}}
const fetchVideo=vi.fn(async()=>new Response(videoBytes,{status:200,headers:{"content-type":"video/mp4"}})) as unknown as typeof fetch;
const input={image:new Blob([new Uint8Array([1])],{type:"image/jpeg"}),prompt:"Commercial portrait product video",resolution:"720p" as const,aspectRatio:"9:16" as const,maxCostUsd:.10};
const media:RenderedVideo={path:"memory.mp4",duration:8,width:720,height:1280,fps:30,videoCodec:"h264",audioCodec:null,hasAudio:false,sizeBytes:100_000};
const qualityInput=(value:RenderedVideo):VideoQualityInput=>({...value,overlay:[],scenes:[],productVisible:true,ctaVisible:true,malformedAssets:false,inheritedRisk:"SAFE"});

describe("FalWanVideoProvider",()=>{
  it("requires FAL_KEY and never exposes it in failures",()=>{const mock=client(),provider=new FalWanVideoProvider({client:mock.value});expect(provider.isAvailable()).toBe(false);expect(provider.getFailureReason(new Error(`request ${key} failed`)).message.includes(key)).toBe(false)});
  it("reports the official Turbo capabilities without inventing frame controls",()=>expect(new FalWanVideoProvider({client:client().value}).getCapabilities()).toMatchObject({imageToVideo:true,resolutions:["480p","580p","720p"],aspectRatios:["auto","16:9","9:16","1:1"],sourceDuration:"PROVIDER_DEFINED",configurableFrames:false,queue:true}));
  it("estimates current per-video prices",()=>{const provider=new FalWanVideoProvider({client:client().value});expect(provider.estimateCost({resolution:"720p"})).toBe(.1);expect(provider.estimateCost({resolution:"580p"})).toBe(.075);expect(provider.estimateCost({resolution:"480p"})).toBe(.05)});
  it("submits, polls and downloads one generation with no paid retry",async()=>{const mock=client(),provider=new FalWanVideoProvider({apiKey:key,client:mock.value,fetchImpl:fetchVideo,sleep:async()=>{},pollIntervalMs:0});const result=await provider.generate(input);expect(result).toMatchObject({requestId:"req-1",actualCostUsd:.1,retryCount:0,resolution:"720p",aspectRatio:"9:16",sourceDurationSeconds:null});expect(mock.submit).toHaveBeenCalledOnce();const payload=mock.submit.mock.calls[0]?.[1];expect(payload).toMatchObject({resolution:"720p",aspect_ratio:"9:16",enable_safety_checker:true,enable_output_safety_checker:true});expect(Object.hasOwn(payload!,"num_frames")).toBe(false);expect(Object.hasOwn(payload!,"frames_per_second")).toBe(false)});
  it("records the request identity before polling and can retrieve without a second paid submit",async()=>{const mock=client(),events:string[]=[],provider=new FalWanVideoProvider({apiKey:key,client:mock.value,fetchImpl:fetchVideo,sleep:async()=>{},pollIntervalMs:0});await provider.generate({...input,onSubmitted:async requestId=>{events.push(requestId);expect(mock.status).toHaveBeenCalledTimes(0)}});expect(events).toEqual(["req-1"]);await provider.retrieve("req-1");expect(mock.submit).toHaveBeenCalledOnce();expect(mock.getResult).toHaveBeenCalledTimes(2)});
  it("blocks a paid request above the cap before submission",async()=>{const mock=client(),provider=new FalWanVideoProvider({apiKey:key,client:mock.value,fetchImpl:fetchVideo});await expect(provider.generate({...input,maxCostUsd:.09})).rejects.toMatchObject({code:"BUDGET_EXCEEDED"});expect(mock.submit).toHaveBeenCalledTimes(0)});
  it("keeps Auto Mode closed until fal is keyed and production approved",()=>{expect(falAutoModeAvailability({keyPresent:true,state:"PRIMARY_CANDIDATE"})).toMatchObject({providerAvailable:false,state:"WAITING_FOR_PROVIDER",reason:"OWNER_APPROVAL_REQUIRED"});expect(falAutoModeAvailability({keyPresent:false,state:"PRODUCTION_APPROVED"})).toMatchObject({providerAvailable:false,state:"WAITING_FOR_PROVIDER",reason:"FAL_KEY_MISSING"});expect(falAutoModeAvailability({keyPresent:true,state:"PRODUCTION_APPROVED"})).toMatchObject({providerAvailable:true,state:"READY",reason:null})});
  it("maps provider and safety failures without retrying",async()=>{const failed=client([{status:"FAILED",error:"provider unavailable"}]),provider=new FalWanVideoProvider({apiKey:key,client:failed.value,sleep:async()=>{},pollIntervalMs:0});await expect(provider.generate(input)).rejects.toMatchObject({code:"PROVIDER_FAILED",retryable:false,actualCostUsd:.1});expect(failed.submit).toHaveBeenCalledOnce();const blocked=client([{status:"FAILED",error:"blocked by safety checker"}]);await expect(new FalWanVideoProvider({apiKey:key,client:blocked.value,sleep:async()=>{},pollIntervalMs:0}).generate(input)).rejects.toMatchObject({code:"SAFETY_REJECTED"})});
  it("times out without an automatic paid retry",async()=>{const mock=client([{status:"IN_PROGRESS"},{status:"IN_PROGRESS"}]),provider=new FalWanVideoProvider({apiKey:key,client:mock.value,sleep:async()=>{},pollIntervalMs:0,maxPollAttempts:2});await expect(provider.generate(input)).rejects.toMatchObject({code:"TIMEOUT",retryable:false});expect(mock.submit).toHaveBeenCalledOnce()});
  it("treats a lost submit response as possibly charged and never retries",async()=>{const mock=client();mock.submit.mockRejectedValueOnce(new Error("connection closed after submit"));const provider=new FalWanVideoProvider({apiKey:key,client:mock.value});await expect(provider.generate(input)).rejects.toMatchObject({requestId:null,actualCostUsd:.1,retryable:false});expect(mock.submit).toHaveBeenCalledOnce()});
  it("fails the master pipeline below quality 85",async()=>{const mock=client(),provider=new FalWanVideoProvider({apiKey:key,client:mock.value,fetchImpl:fetchVideo,sleep:async()=>{}});await expect(generateAcceptedFalWanMaster({provider,request:input,inspect:async()=>media,qualityInput,evaluate:()=>({score:84,status:"RETRY",explanation:{}}),store:async()=>"never"})).rejects.toBeInstanceOf(FalWanProviderError)});
  it("stores only a quality-passing master",async()=>{const mock=client(),provider=new FalWanVideoProvider({apiKey:key,client:mock.value,fetchImpl:fetchVideo,sleep:async()=>{}}),store=vi.fn(async()=>"owner/master/provider-original.mp4");const result=await generateAcceptedFalWanMaster({provider,request:input,inspect:async()=>media,qualityInput,evaluate:()=>({score:95,status:"PASS",explanation:{}}),store});expect(result.status).toBe("READY");expect(store).toHaveBeenCalledOnce()});
});

describe("fal model settings and recovery", () => {
  it("recovers the exact native LTX settings, polls pending work and never submits again", async () => {
    const settings = resolveFalModelSettings({model: FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED, durationSeconds: 10});
    const mock = client([{status: "IN_QUEUE"}, {status: "IN_PROGRESS"}, {status: "COMPLETED"}]);
    const provider = new FalWanVideoProvider({apiKey: key, settings, client: mock.value, fetchImpl: fetchVideo, sleep: async () => {}, pollIntervalMs: 0});
    const result = await provider.retrieve("req-1");
    expect(result).toMatchObject({model: settings.model, endpoint: settings.model, settings, recordedCostUsd: null, costBasis: "ESTIMATED", queueTimeMs: null});
    expect(result.actualCostUsd).toBeCloseTo(241 / 24 * .02);
    expect(mock.status).toHaveBeenCalledTimes(3);
    expect(mock.submit).toHaveBeenCalledTimes(0);
    expect(provider.estimateCost({resolution: "480p"})).toBeCloseTo(241 / 24 * .02);
  });

  it("blocks the uncertain Wan silent quote using its conservative reservation", async () => {
    const mock = client();
    const provider = new FalWanVideoProvider({apiKey: key, model: FAL_MODEL_ENDPOINTS.WAN_26_FLASH, durationSeconds: 10, client: mock.value});
    expect(provider.estimateCost()).toBe(.5);
    await expect(provider.generate({...input, maxCostUsd: .25})).rejects.toMatchObject({code: "BUDGET_EXCEEDED", actualCostUsd: 0});
    expect(mock.value.upload).toHaveBeenCalledTimes(0);
    expect(mock.submit).toHaveBeenCalledTimes(0);
  });

  it("rejects malformed recovered settings and snapshots valid settings independently", () => {
    const settings = {...resolveFalModelSettings({model: FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED, durationSeconds: 10})}, mock = client();
    expect(() => new FalWanVideoProvider({apiKey: key, settings: {...settings, numFrames: 194, durationSeconds: 194 / 24}, client: mock.value})).toThrow("Invalid saved video settings");
    const provider = new FalWanVideoProvider({apiKey: key, settings, client: mock.value});
    settings.resolution = "480p";
    settings.durationSeconds = 193 / 24;
    expect(provider.getSettings()).toMatchObject({resolution: "720p", durationSeconds: 241 / 24, numFrames: 241});
    expect(mock.submit).toHaveBeenCalledTimes(0);
  });

  it("records queue and generation timing only when those states were observed", async () => {
    const mock = client([{status: "IN_QUEUE"}, {status: "IN_PROGRESS"}, {status: "COMPLETED"}]);
    let timestamp = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => timestamp += 100);
    try {
      const provider = new FalWanVideoProvider({apiKey: key, model: FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED, durationSeconds: 8, client: mock.value, fetchImpl: fetchVideo, sleep: async () => {}, pollIntervalMs: 0});
      const result = await provider.generate({...input, maxCostUsd: .2});
      expect(result).toMatchObject({queueTimeMs: 100, generationTimeMs: 100, latencyMs: 400, costBasis: "ESTIMATED", recordedCostUsd: null});
    } finally {clock.mockRestore();}
    const completeImmediately = new FalWanVideoProvider({apiKey: key, client: client().value, fetchImpl: fetchVideo});
    expect(await completeImmediately.generate(input)).toMatchObject({queueTimeMs: null, generationTimeMs: null});
  });

  it("retries only read operations after a temporary network failure", async () => {
    const mock = client();
    mock.status.mockRejectedValueOnce(new TypeError("private status network detail"));
    const provider = new FalWanVideoProvider({apiKey: key, client: mock.value, fetchImpl: fetchVideo, sleep: async () => {}, readRetryAttempts: 1});
    await provider.generate(input);
    expect(mock.status).toHaveBeenCalledTimes(2);
    expect(mock.submit).toHaveBeenCalledOnce();
  });

  it("does not declare a repeated status network failure terminal", async () => {
    const mock = client();
    mock.status.mockRejectedValue(new TypeError(`private ${key}`));
    const provider = new FalWanVideoProvider({apiKey: key, client: mock.value, sleep: async () => {}, readRetryAttempts: 1});
    await expect(provider.generate(input)).rejects.toMatchObject({code: "PROVIDER_FAILED", terminalConfirmed: false, actualCostUsd: .1, requestId: "req-1"});
    expect(mock.status).toHaveBeenCalledTimes(2);
    expect(mock.submit).toHaveBeenCalledOnce();
  });

  it("confirms explicit terminal queue failures without returning raw provider detail", async () => {
    for (const status of ["FAILED", "CANCELLED"]) {
      const mock = client([{status, error: `private ${key}`}]);
      await expect(new FalWanVideoProvider({apiKey: key, client: mock.value}).generate(input)).rejects.toMatchObject({terminalConfirmed: true, actualCostUsd: .1, requestId: "req-1"});
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(new FalWanVideoProvider({client: client().value}).getFailureReason(cyclic)).toMatchObject({code: "PROVIDER_FAILED", message: "Video generation could not be completed"});
  });

  it("treats missing and failed downloads after completion as confirmed unusable output", async () => {
    const missing = client([{status: "COMPLETED"}], {data: {video: {}}, requestId: "req-1"});
    await expect(new FalWanVideoProvider({apiKey: key, client: missing.value}).generate(input)).rejects.toMatchObject({code: "INVALID_OUTPUT", terminalConfirmed: true, actualCostUsd: .1});
    const brokenDownload = vi.fn(async () => {throw new TypeError(`private ${key}`);}) as unknown as typeof fetch;
    await expect(new FalWanVideoProvider({apiKey: key, client: client().value, fetchImpl: brokenDownload, sleep: async () => {}}).generate(input)).rejects.toMatchObject({code: "DOWNLOAD_FAILED", terminalConfirmed: true, actualCostUsd: .1});
  });

  it("recognizes the official COMPLETED-with-error terminal failure format", async () => {
    const mock = client([{status: "COMPLETED", error: "blocked by safety checker"}]);
    const provider = new FalWanVideoProvider({apiKey: key, client: mock.value});
    await expect(provider.generate(input)).rejects.toMatchObject({code: "SAFETY_REJECTED", terminalConfirmed: true, actualCostUsd: .1, requestId: "req-1"});
    expect(mock.getResult).toHaveBeenCalledTimes(0);
    expect(mock.submit).toHaveBeenCalledOnce();
  });

  it("recognizes error_type-only terminal failures without retrying or cancelling them", async () => {
    for (const [error_type, code] of [["request_timeout", "TIMEOUT"], ["client_cancelled", "CANCELLED"], ["runner_server_error", "PROVIDER_FAILED"]] as const) {
      const mock = client([{status: "COMPLETED", error_type}]), cancel = vi.fn(async () => ({status: "CANCELLATION_REQUESTED"}));
      const provider = new FalWanVideoProvider({apiKey: key, client: {...mock.value, cancel}, readRetryAttempts: 2});
      await expect(provider.generate(input)).rejects.toMatchObject({code, terminalConfirmed: true, actualCostUsd: .1, requestId: "req-1", retryable: false});
      expect(mock.status).toHaveBeenCalledOnce();
      expect(mock.getResult).toHaveBeenCalledTimes(0);
      expect(cancel).toHaveBeenCalledTimes(0);
      expect(mock.submit).toHaveBeenCalledOnce();
    }
  });

  it("rejects unsafe result references and a mismatched request identity before download", async () => {
    for (const result of [{data: {video: {url: "https://127.0.0.1/private"}}, requestId: "req-1"}, {data: {video: {url: videoUrl}}, requestId: "other-request"}]) {
      const mock = client([{status: "COMPLETED"}], result), download = vi.fn(async () => new Response(videoBytes));
      const provider = new FalWanVideoProvider({apiKey: key, client: mock.value, fetchImpl: download as typeof fetch});
      await expect(provider.generate(input)).rejects.toMatchObject({code: "INVALID_OUTPUT", terminalConfirmed: true, requestId: "req-1", actualCostUsd: .1});
      expect(download).toHaveBeenCalledTimes(0);
    }
  });

  it("cancels once on an abort after submission while preserving uncertain charges", async () => {
    const mock = client(), cancel = vi.fn(async () => ({success: true})), controller = new AbortController();
    const provider = new FalWanVideoProvider({apiKey: key, client: {...mock.value, cancel}});
    await expect(provider.generate({...input, signal: controller.signal, onSubmitted: async () => controller.abort()})).rejects.toMatchObject({code: "CANCELLED", terminalConfirmed: false, requestId: "req-1", actualCostUsd: .1});
    expect(cancel).toHaveBeenCalledOnce();
    expect(mock.submit).toHaveBeenCalledOnce();
    expect(mock.status).toHaveBeenCalledTimes(0);
  });

  it("does not start work for an already aborted request", async () => {
    const mock = client(), controller = new AbortController();
    controller.abort();
    await expect(new FalWanVideoProvider({apiKey: key, client: mock.value}).generate({...input, signal: controller.signal})).rejects.toMatchObject({code: "CANCELLED", actualCostUsd: 0, requestId: null});
    expect(mock.value.upload).toHaveBeenCalledTimes(0);
    expect(mock.submit).toHaveBeenCalledTimes(0);
  });

  it("rechecks authorization after upload and rejects before a paid submission when cancelled", async () => {
    const mock = client(), beforeSubmit = vi.fn(async () => {
      expect(mock.value.upload).toHaveBeenCalledOnce();
      expect(mock.submit).toHaveBeenCalledTimes(0);
      throw new Error("generation cancelled during upload");
    });
    await expect(new FalWanVideoProvider({apiKey: key, client: mock.value}).generate({...input, beforeSubmit})).rejects.toMatchObject({code: "CANCELLED", actualCostUsd: 0, requestId: null, terminalConfirmed: false});
    expect(beforeSubmit).toHaveBeenCalledOnce();
    expect(mock.submit).toHaveBeenCalledTimes(0);
  });

  it("bounds pending work by timeout, attempts cancellation and never submits twice", async () => {
    const mock = client(), cancel = vi.fn(async () => ({success: true}));
    mock.status.mockImplementation(() => new Promise(() => {}));
    const provider = new FalWanVideoProvider({apiKey: key, client: {...mock.value, cancel}, timeoutMs: 10});
    await expect(provider.generate(input)).rejects.toMatchObject({code: "TIMEOUT", terminalConfirmed: false, requestId: "req-1", actualCostUsd: .1});
    expect(cancel).toHaveBeenCalledOnce();
    expect(mock.submit).toHaveBeenCalledOnce();
  });
});

describe("fal direct HTTP paid submission", () => {
  it("uses a separate credential client per provider and never calls SDK queue submission", () => {
    const before = vi.mocked(createFalClient).mock.calls.length;
    new FalWanVideoProvider({apiKey: "test-key-a"});
    new FalWanVideoProvider({apiKey: "test-key-b"});
    expect(vi.mocked(createFalClient).mock.calls.slice(before)).toEqual([[{credentials: "test-key-a"}], [{credentials: "test-key-b"}]]);
  });

  it("makes exactly one paid POST for rate, billing, safety and server rejections", async () => {
    for (const [status, code, cost] of [[429, "RATE_LIMITED", 0], [402, "BILLING_FAILED", 0], [422, "SAFETY_REJECTED", 0], [503, "PROVIDER_FAILED", .1]] as const) {
      const http = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
        expect(String(url)).toBe(`https://queue.fal.run/${FAL_MODEL_ENDPOINTS.WAN_22_TURBO}`);
        expect(options?.method).toBe("POST");
        expect(options?.headers).toMatchObject({"X-Fal-No-Retry": "1"});
        expect(options?.redirect).toBe("error");
        return Response.json({detail: status === 422 ? "blocked by safety" : `private ${key}`}, {status});
      });
      const provider = new FalWanVideoProvider({apiKey: key, fetchImpl: http as unknown as typeof fetch, sleep: async () => {}, readRetryAttempts: 2});
      await expect(provider.generate(input)).rejects.toMatchObject({code, actualCostUsd: cost, requestId: null, terminalConfirmed: false});
      expect(http).toHaveBeenCalledOnce();
      expect(http.mock.calls[0]?.[1]?.method).toBe("POST");
      // The mock has no SDK queue object, so successful entry proves direct HTTP.
      expect(vi.mocked(createFalClient).mock.results.at(-1)?.value).toHaveProperty("storage");
    }
  });

  it("uses full endpoint only for submit and provider request routes for read and cancel", async () => {
    const calls: Array<{url: string; method: string}> = [];
    const http = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      calls.push({url: String(url), method: options?.method ?? "GET"});
      if (options?.method === "POST") return Response.json({request_id: "req/id"});
      if (options?.method === "PUT") return Response.json({status: "CANCELLATION_REQUESTED"}, {status: 202});
      if (String(url).endsWith("status?logs=0")) return Response.json({status: "COMPLETED"});
      if (String(url) === videoUrl) return new Response(videoBytes);
      return Response.json({video: {url: videoUrl}});
    });
    const provider = new FalWanVideoProvider({apiKey: key, model: FAL_MODEL_ENDPOINTS.WAN_26_FLASH, durationSeconds: 10, fetchImpl: http as typeof fetch});
    await provider.generate({...input, maxCostUsd: .5});
    expect(await provider.cancel("req/id")).toBe(true);
    expect(calls).toEqual([
      {url: `https://queue.fal.run/${FAL_MODEL_ENDPOINTS.WAN_26_FLASH}`, method: "POST"},
      {url: "https://queue.fal.run/wan/v2.6/requests/req%2Fid/status?logs=0", method: "GET"},
      {url: "https://queue.fal.run/wan/v2.6/requests/req%2Fid", method: "GET"},
      {url: videoUrl, method: "GET"},
      {url: "https://queue.fal.run/wan/v2.6/requests/req%2Fid/cancel", method: "PUT"},
    ]);
  });

  it("treats HTTP 202 cancellation as an acknowledgement while preserving the paid hold", async () => {
    const controller = new AbortController();
    const http = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => options?.method === "POST"
      ? Response.json({request_id: "req-1"}) : Response.json({status: "CANCELLATION_REQUESTED"}, {status: 202}));
    const provider = new FalWanVideoProvider({apiKey: key, fetchImpl: http as typeof fetch});
    await expect(provider.generate({...input, signal: controller.signal, onSubmitted: async () => controller.abort()})).rejects.toMatchObject({code: "CANCELLED", terminalConfirmed: false, actualCostUsd: .1, requestId: "req-1"});
    expect(http.mock.calls.map(call => call[1]?.method)).toEqual(["POST", "PUT"]);
  });

  it("retries temporary HTTP failures on status, result and media GETs without another POST", async () => {
    const counts = new Map<string, number>();
    const http = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      if (options?.method === "POST") return Response.json({request_id: "req-1"});
      const reference = String(url), count = (counts.get(reference) ?? 0) + 1;
      counts.set(reference, count);
      if (count === 1) return new Response(null, {status: 503});
      if (reference.endsWith("status?logs=0")) return Response.json({status: "COMPLETED"});
      return reference === videoUrl ? new Response(videoBytes) : Response.json({video: {url: videoUrl}});
    });
    await new FalWanVideoProvider({apiKey: key, fetchImpl: http as typeof fetch, sleep: async () => {}}).generate(input);
    expect(http.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(1);
    expect([...counts.values()]).toEqual([2, 2, 2]);
  });

  it("caps read retries at two and preserves uncertainty when status stays unavailable", async () => {
    const http = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => options?.method === "POST"
      ? Response.json({request_id: "req-1"}) : new Response(null, {status: 503}));
    const provider = new FalWanVideoProvider({apiKey: key, fetchImpl: http as typeof fetch, sleep: async () => {}, readRetryAttempts: 100});
    await expect(provider.generate(input)).rejects.toMatchObject({code: "PROVIDER_FAILED", terminalConfirmed: false, actualCostUsd: .1, requestId: "req-1"});
    expect(http.mock.calls.map(call => call[1]?.method)).toEqual(["POST", "GET", "GET", "GET"]);
  });
});

describe("fal media download boundaries", () => {
  it("rejects private hosts, credentials, HTTP and unexpected hosts before fetching", async () => {
    const http = vi.fn(async () => new Response(videoBytes));
    const provider = new FalWanVideoProvider({client: client().value, fetchImpl: http as unknown as typeof fetch});
    for (const url of ["https://127.0.0.1/video.mp4", "https://[::1]/video.mp4", "https://10.0.0.1/video.mp4", "https://fal.media.evil.invalid/video.mp4", "https://user:password@v3b.fal.media/video.mp4", "https://v3b.fal.media:8443/video.mp4", "http://v3b.fal.media/video.mp4", "https://example.invalid/video.mp4", "https://storage.googleapis.com/unrelated/video.mp4", "https://storage.googleapis.com/falserverless.evil/video.mp4", "https://storage.googleapis.com/falserverless/%2e%2e/unrelated/video.mp4", "https://storage.googleapis.com/falserverless/%2F..%2Funrelated/video.mp4", "not-a-url"]) {
      await expect(provider.downloadResult(url)).rejects.toMatchObject({code: "INVALID_OUTPUT"});
    }
    expect(http).toHaveBeenCalledTimes(0);
  });

  it("accepts the fal-owned storage URL published by the official LTX output schema", async () => {
    const url = "https://storage.googleapis.com/falserverless/example_outputs/ltxv-image-to-video-output.mp4";
    const http = vi.fn(async (requestUrl: string | URL | Request) => {expect(String(requestUrl)).toBe(url); return new Response(videoBytes);});
    const provider = new FalWanVideoProvider({client: client().value, fetchImpl: http as unknown as typeof fetch});
    expect(await provider.downloadResult(url)).toEqual(videoBytes);
    expect(http).toHaveBeenCalledOnce();
    expect(http.mock.calls[0]?.[0]).toBe(url);
  });

  it("requests no redirects and rejects a redirect to an outside host", async () => {
    const http = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      expect(options?.redirect).toBe("error");
      return new Response(null, {status: 302, headers: {location: "https://127.0.0.1/private"}});
    });
    const provider = new FalWanVideoProvider({client: client().value, fetchImpl: http as typeof fetch});
    await expect(provider.downloadResult(videoUrl)).rejects.toMatchObject({code: "DOWNLOAD_FAILED"});
    expect(http).toHaveBeenCalledOnce();
  });

  it("rejects a declared payload above 100 MiB before reading the body", async () => {
    const http = vi.fn(async () => new Response(videoBytes, {headers: {"content-length": String(100 * 1024 * 1024 + 1)}}));
    const provider = new FalWanVideoProvider({client: client().value, fetchImpl: http as unknown as typeof fetch});
    await expect(provider.downloadResult(videoUrl)).rejects.toMatchObject({code: "INVALID_OUTPUT"});
  });

  it("counts streamed bytes even when the server omits content length", async () => {
    const read = vi.fn(async () => ({done: false, value: {byteLength: 100 * 1024 * 1024 + 1}}));
    const cancel = vi.fn(async () => {}), releaseLock = vi.fn();
    const response = {ok: true, redirected: false, url: videoUrl, headers: new Headers(), body: {getReader: () => ({read, cancel, releaseLock})}} as unknown as Response;
    const provider = new FalWanVideoProvider({client: client().value, fetchImpl: vi.fn(async () => response) as unknown as typeof fetch});
    await expect(provider.downloadResult(videoUrl)).rejects.toMatchObject({code: "INVALID_OUTPUT"});
    expect(read).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("bounds a stalled response body even when the caller supplies an unexpired signal", async () => {
    const response = new Response(new ReadableStream<Uint8Array>()), controller = new AbortController();
    const provider = new FalWanVideoProvider({client: client().value, fetchImpl: vi.fn(async () => response) as unknown as typeof fetch, timeoutMs: 10});
    await expect(provider.downloadResult(videoUrl, {signal: controller.signal})).rejects.toMatchObject({code: "TIMEOUT"});
  });
});
