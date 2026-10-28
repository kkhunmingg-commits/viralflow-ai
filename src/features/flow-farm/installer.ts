import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const INSTALLER_VERSION = "1.0.0";
/** The worker files the installed copy runs; farm.mjs imports only these. */
export const INSTALLED_WORKER_FILES = ["farm.mjs", "farm-core.mjs", "farm-driver.mjs", "core.mjs", "media.mjs"] as const;
const MARKER = "#PS1START#";

/**
 * One double-clickable Windows file: a short batch header hands the rest of the same file to PowerShell, so the
 * person never opens PowerShell. Everything after the marker is setup.ps1 with this account's values filled in.
 */
export function buildInstaller(input: { portal: string; token: string; script: string; files: Record<string, string> }) {
  const literal = (value: string) => value.replace(/'/g, "''");
  if (!/^https?:\/\/[^'\s]+$/.test(input.portal) || !/^vfw_[A-Za-z0-9_-]+$/.test(input.token)) throw new Error("INVALID_INSTALLER_INPUT");
  const files = Object.entries(input.files)
    .map(([name, text]) => `  '${literal(name)}' = '${Buffer.from(text, "utf8").toString("base64")}'`).join("\r\n");
  const script = input.script.replace(/\r?\n/g, "\r\n")
    .replace("__PORTAL__", literal(input.portal)).replace("__TOKEN__", literal(input.token))
    .replace("__VERSION__", INSTALLER_VERSION).replace("__FILES__", () => files);
  const header = [
    "@echo off",
    "title ViralFlow",
    "echo Installing ViralFlow clip maker. Please wait 2-5 minutes...",
    'set "VF_SELF=%~f0"',
    // The marker is split in the command so only the real one below is found.
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:VF_SELF,[Text.Encoding]::UTF8); iex $t.Substring($t.IndexOf('${MARKER.slice(0, 4)}'+'${MARKER.slice(4)}')+${MARKER.length})"`,
    "exit /b %errorlevel%",
    MARKER,
  ].join("\r\n");
  return `${header}\r\n${script}`;
}

/** Reads setup.ps1 and the worker files from the deployed bundle (traced by next.config's outputFileTracingIncludes). */
export async function installerSources(root = join(process.cwd(), "workers", "flow-browser")) {
  const script = await readFile(join(root, "installer", "setup.ps1"), "utf8");
  const files = Object.fromEntries(await Promise.all(INSTALLED_WORKER_FILES.map(async name => [name, await readFile(join(root, name), "utf8")])));
  return { script, files };
}
