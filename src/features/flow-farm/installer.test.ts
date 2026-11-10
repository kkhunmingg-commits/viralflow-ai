import { writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { buildInstaller, INSTALLED_WORKER_FILES, VERSION_WORKER_FILES, installerSources, workerBundle, workerVersion, zipOne } = await import("./installer");

const token = `vfw_${"A".repeat(43)}`;

describe("Windows installer", () => {
  it("wraps setup.ps1 with this account's site, token and every worker file farm.mjs needs", async () => {
    const sources = await installerSources();
    const file = buildInstaller({ portal: "https://viralflow.example", token, ...sources });
    const [header, script] = file.split("\r\n#PS1START#\r\n");
    expect(header.startsWith("@echo off")).toBe(true);
    // The batch header holds only ASCII and never the full marker, so PowerShell starts at the real one.
    expect(/^[\x20-\x7e\r\n]*$/.test(header)).toBe(true);
    expect(header.includes("#PS1START#")).toBe(false);
    expect(script).toContain("$portal = 'https://viralflow.example'");
    expect(script).toContain(`$token = '${token}'`);
    expect(script).not.toMatch(/__(PORTAL|TOKEN|VERSION|FILES)__/);
    for (const name of INSTALLED_WORKER_FILES) {
      const encoded = script.match(new RegExp(`'${name.replace(".", "\\.")}' = '([^']+)'`))?.[1] ?? "";
      expect(Buffer.from(encoded, "base64").toString("utf8")).toBe(sources.files[name]);
    }
    const imported = [...sources.files["farm.mjs"].matchAll(/from "\.\/([^"]+)"/g), ...sources.files["farm-driver.mjs"].matchAll(/from "\.\/([^"]+)"/g)].map(m => m[1]);
    for (const name of imported) expect(INSTALLED_WORKER_FILES).toContain(name);
    // INSTALLER_OUT=path writes the file for a manual run on Windows.
    if (process.env.INSTALLER_OUT) await writeFile(process.env.INSTALLER_OUT, file);
  });

  it("zips the installer so Chrome lets it download", async () => {
    const zip = zipOne("ViralFlow-Setup.cmd", "@echo off\r\nตั้งค่า");
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const { crc32 } = await import("node:zlib");
    const data = Buffer.from("@echo off\r\nตั้งค่า");
    expect(zip.readUInt32LE(14)).toBe(crc32(data));
    expect(zip.subarray(30, 49).toString()).toBe("ViralFlow-Setup.cmd");
    expect(zip.subarray(49, 49 + data.length).equals(data)).toBe(true);
    const end = zip.length - 22;
    expect(zip.readUInt32LE(end)).toBe(0x06054b50);
    expect(zip.readUInt32LE(zip.readUInt32LE(end + 16))).toBe(0x02014b50);
    if (process.env.INSTALLER_ZIP_OUT) await writeFile(process.env.INSTALLER_ZIP_OUT, zip);
  });

  it("refuses values that could break out of the script", () => {
    expect(() => buildInstaller({ portal: "https://x.example/'; calc", token, script: "", files: {} })).toThrow("INVALID_INSTALLER_INPUT");
    expect(() => buildInstaller({ portal: "https://x.example", token: "vfw_a'b", script: "", files: {} })).toThrow("INVALID_INSTALLER_INPUT");
  });
});

describe("setup.ps1", () => {
  it("has no curly quotes: PowerShell treats them as string delimiters (a success box broke on 2 Nov)", async () => {
    const { script } = await installerSources();
    expect(script).not.toMatch(/[\u201C\u201D\u2018\u2019]/);
  });
});

describe("worker self-update", () => {
  it("the site and the installed worker hash the same files the same way", async () => {
    const sources = await installerSources();
    const farm = sources.files["farm.mjs"];
    const list = farm.match(/const WORKER_FILES = (\[[^\]]+\])/)?.[1];
    expect(list && JSON.parse(list)).toEqual([...INSTALLED_WORKER_FILES]);
    // Re-run the worker's own function body on the same files.
    const body = farm.match(/export function workerVersion\(files\) \{([\s\S]*?)\n\}/)?.[1];
    const { createHash } = await import("node:crypto");
    const versioned = farm.match(/const VERSION_FILES = (\[[^\]]+\])/)?.[1];
    expect(versioned && JSON.parse(versioned)).toEqual([...VERSION_WORKER_FILES]);
    const workerSide = new Function("files", "createHash", "VERSION_FILES", body!) as (f: Record<string, string>, c: typeof createHash, w: string[]) => string;
    expect(workerSide(sources.files, createHash, [...VERSION_WORKER_FILES])).toBe(workerVersion(sources.files));
    // A worker from before extension.mjs (it checks the five files it knows) accepts this bundle.
    const old = (await workerBundle()).files;
    const oldSide = createHash("sha256");
    for (const name of ["farm.mjs", "farm-core.mjs", "farm-driver.mjs", "core.mjs", "media.mjs"]) oldSide.update(name).update("\0").update(old[name] ?? "").update("\0");
    expect(oldSide.digest("hex").slice(0, 16)).toBe((await workerBundle()).version);
    expect((await workerBundle()).version).toBe(workerVersion(sources.files));
  });
});
