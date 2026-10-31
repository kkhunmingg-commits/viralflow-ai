import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32 } from "node:zlib";

export const INSTALLER_VERSION = "1.0.1";
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

/**
 * A one-entry, uncompressed .zip. Chrome holds a downloaded .cmd back as "dangerous" behind a hidden Keep button,
 * but lets a .zip through; opening it in Explorer and double-clicking the .cmd inside runs it.
 */
export function zipOne(name: string, content: string, now = new Date()) {
  const data = Buffer.from(content, "utf8"), file = Buffer.from(name, "utf8"), crc = crc32(data);
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
  local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(file.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10); central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(file.length, 28);
  const end = Buffer.alloc(22), centralOffset = local.length + file.length + data.length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + file.length, 12); end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, file, data, central, file, end]);
}

/** Reads setup.ps1 and the worker files from the deployed bundle (traced by next.config's outputFileTracingIncludes). */
export async function installerSources(root = join(process.cwd(), "workers", "flow-browser")) {
  const script = await readFile(join(root, "installer", "setup.ps1"), "utf8");
  const files = Object.fromEntries(await Promise.all(INSTALLED_WORKER_FILES.map(async name => [name, await readFile(join(root, name), "utf8")])));
  return { script, files };
}
