import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { validateDeploymentConfig } from "../src/lib/deployment-config";

if (existsSync(".env.local") && typeof process.loadEnvFile === "function") process.loadEnvFile(".env.local");

function precheck() {
  let supabaseUrl: URL;
  try { supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""); } catch { throw new Error("supabase_url_required"); }
  if (supabaseUrl.protocol !== "https:" || supabaseUrl.username || supabaseUrl.password) throw new Error("supabase_url_invalid");
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!publishable.startsWith("sb_publishable_") || publishable.length < 24) throw new Error("supabase_publishable_key_required");
  validateDeploymentConfig(process.env);
  const names = readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort();
  if (!names.length || names.some((name) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name))) throw new Error("migration_filename_invalid");
  const versions = names.map((name) => name.slice(0, 14));
  if (new Set(versions).size !== versions.length) throw new Error("migration_version_duplicate");
  const logicalNames = names.map((name) => name.slice(15));
  if (new Set(logicalNames).size !== logicalNames.length) throw new Error("migration_name_duplicate");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { packageManager?: string; engines?: { node?: string } };
  if (packageJson.packageManager !== "pnpm@11.19.0" || packageJson.engines?.node !== ">=24.0.0") throw new Error("runtime_contract_changed");
  console.info(`Release precheck passed: ${names.length} local migrations; ${process.env.APP_ENV ?? process.env.VERCEL_ENV ?? "development"} environment`);
}

precheck();
for (const task of ["typecheck", "lint", "test", "build"]) {
  const result = spawnSync("pnpm", [task], { stdio: "inherit", shell: process.platform === "win32" });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
