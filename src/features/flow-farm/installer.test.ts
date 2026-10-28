import { writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { buildInstaller, INSTALLED_WORKER_FILES, installerSources } = await import("./installer");

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

  it("refuses values that could break out of the script", () => {
    expect(() => buildInstaller({ portal: "https://x.example/'; calc", token, script: "", files: {} })).toThrow("INVALID_INSTALLER_INPUT");
    expect(() => buildInstaller({ portal: "https://x.example", token: "vfw_a'b", script: "", files: {} })).toThrow("INVALID_INSTALLER_INPUT");
  });
});
