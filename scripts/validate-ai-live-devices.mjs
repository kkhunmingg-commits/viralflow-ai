// Developer-only isolated PostgreSQL validation. Never connects to Supabase.
// node scripts/validate-ai-live-devices.mjs <absolute PGlite dist/index.js>
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";

if (!process.argv[2]) throw new Error("Pass an isolated PGlite module path; no database URL is accepted");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const device = randomUUID();
const second = randomUUID();
const { publicKey } = generateKeyPairSync("ed25519");
const pem = publicKey.export({ type: "spki", format: "pem" });
const fingerprint = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
const secondKey = generateKeyPairSync("ed25519").publicKey;
const secondPem = secondKey.export({ type: "spki", format: "pem" });
const secondFingerprint = createHash("sha256").update(secondKey.export({ type: "spki", format: "der" })).digest("hex");
let checks = 0;
const check = (condition) => { assert.ok(condition); checks++; };

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    grant usage on schema public to service_role;
  `);
  await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
  await db.exec(readFileSync("supabase/migrations/20261001091106_ai_live_device_registration.sql", "utf8"));
  const challenge = async (who, which) => {
    const id = randomUUID();
    const hash = createHash("sha256").update(id).digest("hex");
    await db.query(`insert into public.ai_live_device_challenges(id,owner_id,device_id,nonce_hash,issued_at,expires_at)
      values ($1,$2,$3,$4,clock_timestamp(),clock_timestamp()+interval '100 seconds')`, [id, who, which, hash]);
    return [id, hash];
  };
  const register = async (who, which, c, expiry = new Date(Date.now() + 3600_000).toISOString(), key = pem, hash = fingerprint) => {
    const result = await db.query("select public.ai_live_register_device($1,$2,$3,$4,$5,$6,$7,$8) as ok",
      [who, which, c[0], c[1], key, hash, 1, expiry]);
    return result.rows[0].ok;
  };
  check(await register(owner, device, await challenge(owner, device)) === true);
  const duplicate = await challenge(owner, device);
  check(await register(owner, device, duplicate) === true);
  check(await register(owner, device, duplicate) === false); // consumed nonce
  check(await register(other, device, await challenge(other, device)) === false); // takeover
  check(await register(owner, second, await challenge(owner, second)) === false); // key reuse
  check(await register(owner, second, await challenge(owner, second), undefined, secondPem, secondFingerprint) === false); // actual device limit, independent identity
  check(await register(owner, device, await challenge(owner, device), new Date(Date.now() - 1000).toISOString()) === false);
  const nonce = createHash("sha256").update(randomUUID()).digest("hex");
  const claim = async (who) => (await db.query("select public.ai_live_claim_device_lease($1,$2,$3,$4,1) as ok",
    [who, device, nonce, new Date(Date.now() + 90_000).toISOString()])).rows[0].ok;
  check(await claim(other) === false);
  check(await claim(owner) === true);
  check(await claim(owner) === false);
  check((await db.query("select public.ai_live_revoke_device($1,$2) as ok", [other, device])).rows[0].ok === false);
  check((await db.query("select public.ai_live_revoke_device($1,$2) as ok", [owner, device])).rows[0].ok === true);
  check(await claim(owner) === false);
  check(await register(owner, second, await challenge(owner, second), undefined, secondPem, secondFingerprint) === true); // revoked slot can be reused
  check(await register(owner, device, await challenge(owner, device)) === false); // cannot revive revoked device over the limit
  const tables = await db.query("select relrowsecurity from pg_class where relname in ('ai_live_devices','ai_live_device_challenges','ai_live_device_lease_nonces')");
  check(tables.rows.length === 3 && tables.rows.every((table) => table.relrowsecurity));
  check((await db.query("select indexname from pg_indexes where schemaname='public' and indexname='ai_live_device_challenges_owner_expiry_idx'")).rows.length === 1);
  for (const role of ["anon", "authenticated"]) {
    const access = await db.query("select has_table_privilege($1,'public.ai_live_devices','select') as read, has_function_privilege($1,'public.ai_live_revoke_device(uuid,uuid)','execute') as mutate", [role]);
    check(access.rows[0].read === false && access.rows[0].mutate === false);
    const privileges = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like 'ai_live_%' and has_function_privilege($1,p.oid,'execute')`, [role]);
    check(privileges.rows.length === 0);
    const tablePrivileges = await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname like 'ai_live_device%' and c.relkind='r'
      and (has_table_privilege($1,c.oid,'select') or has_table_privilege($1,c.oid,'insert')
        or has_table_privilege($1,c.oid,'update') or has_table_privilege($1,c.oid,'delete'))`, [role]);
    check(tablePrivileges.rows.length === 0);
  }
  await db.exec("set role service_role");
  check((await db.query("select count(*)::int as count from public.ai_live_devices")).rows[0].count === 2);
  await db.exec("reset role; set role authenticated");
  await assert.rejects(db.query("select * from public.ai_live_devices")); checks++;
  await assert.rejects(db.query("select public.ai_live_revoke_device($1,$2)", [owner, device])); checks++;
  console.log(`Isolated AI LIVE migration: ${checks} checks passed; no remote database touched`);
} finally { await db.close(); }
