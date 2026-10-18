import { describe, expect, it, vi } from "vitest";
import { configuration, Consent, DriveOneFileTest, DRIVE_FILE_SCOPE, exchangeCode, operationUrl, REDIRECT_URI, safeDownloadUrl, VIDS_MIME } from "./drive";
const config = { clientId: "local-test.apps.googleusercontent.com", clientSecret: "test-only-not-a-real-secret", pickerKey: "test-only", projectNumber: "123" };
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
const metadata = { id: "selected-project", mimeType: VIDS_MIME, capabilities: { canDownload: true } };
const complete = { name: "operations/mock-operation", done: true, response: { downloadUri: "https://drive.usercontent.google.com/download?test=fixture" } };
function mp4() { const bytes = Buffer.alloc(1200); bytes.write("ftyp", 4); return new Response(bytes, { headers: { "Content-Type": "video/mp4" } }); }
const expiry = () => Date.now() + 60_000;
describe("local Google Vids one-file Drive proof (mock transport, not a Pro account test)", () => {
  it("requires dedicated local configuration, never reuses production env names", () => {
    expect(configuration({ GOOGLE_CLIENT_ID: config.clientId, GOOGLE_CLIENT_SECRET: config.clientSecret })).toBeNull();
    expect(configuration({ GOOGLE_VIDS_LOCAL_CLIENT_ID: config.clientId, GOOGLE_VIDS_LOCAL_CLIENT_SECRET: config.clientSecret,
      GOOGLE_VIDS_LOCAL_PICKER_KEY: config.pickerKey, GOOGLE_VIDS_LOCAL_PROJECT_NUMBER: config.projectNumber })).toEqual(config);
  });
  it("requests only drive.file online and checks one-use state against a browser cookie", () => {
    const consent = new Consent(config), grant = consent.begin(), url = new URL(grant.url);
    expect(url.searchParams.get("scope")).toBe(DRIVE_FILE_SCOPE);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("access_type")).toBe("online");
    expect(grant.url).not.toContain(config.clientSecret);
    consent.consume(grant.state, grant.state);
    expect(() => consent.consume(grant.state, grant.state)).toThrow("CONSENT_STATE_INVALID");
  });
  it("rejects mismatched cookie/state and expired consent", () => {
    let now = 1; const consent = new Consent(config, () => now), first = consent.begin();
    expect(() => consent.consume(first.state, "wrong")).toThrow("CONSENT_STATE_INVALID");
    const next = consent.begin(); now += 300_001;
    expect(() => consent.consume(next.state, next.state)).toThrow("CONSENT_STATE_INVALID");
  });
  it("discards refresh tokens and refuses a broader Drive grant", async () => {
    const grant = { access_token: "mock-only", token_type: "Bearer", expires_in: 3600, scope: DRIVE_FILE_SCOPE, refresh_token: "must-not-retain" };
    const result = await exchangeCode(config, "mock-code", vi.fn().mockResolvedValue(response(grant)));
    expect(result).toHaveProperty("token", "mock-only"); expect(result).not.toHaveProperty("refresh_token");
    await expect(exchangeCode(config, "mock-code", vi.fn().mockResolvedValue(response({ ...grant, scope: "https://www.googleapis.com/auth/drive" })))).rejects.toThrow("CONSENT_SCOPE_INVALID");
  });
  it("reads selected file metadata, handles immediate completion and protects duplicate downloads", async () => {
    const request = vi.fn().mockResolvedValueOnce(response(metadata)).mockResolvedValueOnce(response(complete)).mockResolvedValueOnce(mp4());
    const test = new DriveOneFileTest("mock-only", expiry(), request);
    expect(await test.select(metadata.id)).toMatchObject({ canDownload: true, mimeType: VIDS_MIME });
    const [a, b] = await Promise.all([test.download(), test.download()]); expect(a).toEqual(b);
    expect(test.calls).toEqual({ metadata: 1, download: 1, polls: 0, content: 1 });
    expect(request.mock.calls[1][0]).toContain("/download?mimeType=video/mp4");
    expect(request.mock.calls[2][1].headers).not.toHaveProperty("Authorization");
    await expect(test.select("another-project")).rejects.toThrow("ONE_FILE_ONLY");
  });
  it("polls a pending operation with the same auth and carries resource keys", async () => {
    const request = vi.fn().mockResolvedValueOnce(response({ ...metadata, resourceKey: "mock-resource-key" }))
      .mockResolvedValueOnce(response({ name: "mock-operation", done: false })).mockResolvedValueOnce(response(complete)).mockResolvedValueOnce(mp4());
    const sleep = vi.fn().mockResolvedValue(undefined), test = new DriveOneFileTest("mock-only", expiry(), request, sleep);
    await test.select(metadata.id); await test.download();
    expect(test.calls.polls).toBe(1); expect(sleep).toHaveBeenCalledWith(10000);
    expect(request.mock.calls[2][0]).toBe("https://www.googleapis.com/drive/v3/operations/mock-operation");
    expect(request.mock.calls[2][1].headers).toMatchObject({ Authorization: "Bearer mock-only", "X-Goog-Drive-Resource-Keys": `${metadata.id}/mock-resource-key` });
  });
  it.each([{ ...metadata, capabilities: { canDownload: false } }, { ...metadata, mimeType: "video/mp4" }, { ...metadata, trashed: true }])("does not download when selected project metadata is ineligible", async data => {
    const request = vi.fn().mockResolvedValue(response(data)), test = new DriveOneFileTest("mock-only", expiry(), request);
    await expect(test.select(metadata.id)).rejects.toThrow(); await expect(test.download()).rejects.toThrow("SELECT_FILE_FIRST");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("bounded pending operation never resubmits after timeout", async () => {
    const request = vi.fn().mockImplementation(async () => response({ name: "mock-operation", done: false })).mockResolvedValueOnce(response(metadata));
    const test = new DriveOneFileTest("mock-only", expiry(), request, async () => {}); await test.select(metadata.id);
    await expect(test.download()).rejects.toThrow("TIMEOUT_NO_RESUBMIT"); await expect(test.download()).rejects.toThrow("TIMEOUT_NO_RESUBMIT");
    expect(test.calls.download).toBe(1); expect(test.calls.polls).toBe(12);
  });
  it("unknown download POST outcome is not silently retried", async () => {
    const request = vi.fn().mockResolvedValueOnce(response(metadata)).mockRejectedValueOnce(new Error("mock network outage"));
    const test = new DriveOneFileTest("mock-only", expiry(), request); await test.select(metadata.id);
    await expect(test.download()).rejects.toThrow(); await expect(test.download()).rejects.toThrow(); expect(test.calls.download).toBe(1);
  });
  it("fails clearly on Drive denial without retaining the raw provider body", async () => {
    const request = vi.fn().mockResolvedValue(new Response("PRIVATE_PROVIDER_DETAIL", { status: 403 }));
    const test = new DriveOneFileTest("mock-only", expiry(), request);
    await expect(test.select(metadata.id)).rejects.toThrow("GOOGLE_HTTP_403");
  });
  it("never fetches failed operations or external redirects", async () => {
    const request = vi.fn().mockResolvedValueOnce(response(metadata)).mockResolvedValueOnce(response({ done: true, error: { message: "PRIVATE" } }));
    const test = new DriveOneFileTest("mock-only", expiry(), request); await test.select(metadata.id);
    await expect(test.download()).rejects.toThrow("DOWNLOAD_OPERATION_FAILED"); expect(test.calls.content).toBe(0);
    const redirect = vi.fn().mockResolvedValueOnce(response(metadata)).mockResolvedValueOnce(response(complete))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://example.com/steal" } }));
    const second = new DriveOneFileTest("mock-only", expiry(), redirect); await second.select(metadata.id);
    await expect(second.download()).rejects.toThrow("HOST_NOT_APPROVED"); expect(second.calls.content).toBe(1);
  });
  it("rejects HTML, invalid MP4 and oversized content", async () => {
    for (const content of [new Response("<html>", { headers: { "Content-Type": "text/html" } }),
      new Response(Buffer.alloc(1200), { headers: { "Content-Type": "video/mp4" } }),
      new Response("fixture", { headers: { "Content-Type": "video/mp4", "Content-Length": "999999999" } })]) {
      const request = vi.fn().mockResolvedValueOnce(response(metadata)).mockResolvedValueOnce(response(complete)).mockResolvedValueOnce(content);
      const test = new DriveOneFileTest("mock-only", expiry(), request); await test.select(metadata.id); await expect(test.download()).rejects.toThrow();
    }
  });
  it("token expiry and clear block further access", async () => {
    const request = vi.fn(), expired = new DriveOneFileTest("mock-only", Date.now() - 1, request);
    await expect(expired.select(metadata.id)).rejects.toThrow("CONSENT_EXPIRED"); expect(request).not.toHaveBeenCalled();
    const test = new DriveOneFileTest("mock-only", expiry(), request); test.clear(); expect(() => test.pickerToken()).toThrow("CONSENT_EXPIRED");
  });
  it("validates operation identifiers and confines content hosts", () => {
    expect(operationUrl("operations/test-op")).toBe("https://www.googleapis.com/drive/v3/operations/operations%2Ftest-op");
    expect(operationUrl("test-op")).toBe("https://www.googleapis.com/drive/v3/operations/test-op");
    for (const name of ["../file", "https://evil/", "operations/../../file"]) expect(() => operationUrl(name)).toThrow();
    for (const url of ["http://docs.google.com/x", "https://docs.google.com.evil.test/x", "https://127.0.0.1/x", "https://user:password@docs.google.com/x"]) expect(() => safeDownloadUrl(url)).toThrow();
  });
});
