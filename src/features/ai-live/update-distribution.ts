import "server-only";
import { z } from "zod";
import { signLiveEnvelope, type LiveSigningConfiguration } from "./server-config";

export const LIVE_UPDATE_MANIFEST_SECONDS = 3600;
export const LIVE_UPDATE_MAX_PACKAGE_BYTES = 256 * 1024 * 1024;
const semanticVersion = z.string().regex(/^(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})$/);
const updateVersions = z.strictObject({ web: semanticVersion, agent: semanticVersion, worker: semanticVersion });

function compareVersion(one: string, two: string) {
  const left = one.split(".").map(Number), right = two.split(".").map(Number);
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index] - right[index];
  return 0;
}

export const liveUpdateReleaseSchema = z.strictObject({
  versions: updateVersions,
  minimumVersions: updateVersions,
  mandatory: z.boolean(),
  rollbackVersion: semanticVersion.nullable(),
  package: z.strictObject({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().positive().max(LIVE_UPDATE_MAX_PACKAGE_BYTES),
  }),
}).refine((release) => (Object.keys(release.versions) as Array<keyof typeof release.versions>)
  .every((component) => compareVersion(release.minimumVersions[component], release.versions[component]) <= 0)
  && release.versions.web === release.versions.agent && release.versions.agent === release.versions.worker
  && release.minimumVersions.web === release.minimumVersions.agent && release.minimumVersions.agent === release.minimumVersions.worker
  && (release.rollbackVersion === null || compareVersion(release.rollbackVersion, release.versions.agent) < 0));

export interface LiveUpdateRelease {
  origin: string;
  release: z.infer<typeof liveUpdateReleaseSchema>;
}

function publicReleaseOrigin(value: string | undefined): string | null {
  if (typeof value !== "string" || !value || value.length > 512) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || url.pathname !== "/" || (url.port && url.port !== "443")
      || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(url.hostname)
      || /(?:^|\.)(?:localhost|local|internal|lan|test)$/.test(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}

// Feature-specific configuration is parsed only when the authenticated route is
// called. Nothing is provisioned, uploaded, fetched or activated by this helper.
export function readLiveUpdateRelease(environment: Readonly<Record<string, string | undefined>> = process.env): LiveUpdateRelease | null {
  const origin = publicReleaseOrigin(environment.AI_LIVE_UPDATE_ORIGIN);
  const json = environment.AI_LIVE_UPDATE_RELEASE_JSON;
  if (!origin || !json || json.length > 4096) return null;
  try {
    const parsed = liveUpdateReleaseSchema.safeParse(JSON.parse(json));
    return parsed.success ? { origin, release: parsed.data } : null;
  } catch { return null; }
}

export interface LiveUpdateManifestPayload {
  v: 2;
  issuedAt: number;
  expiresAt: number;
  versions: z.infer<typeof updateVersions>;
  minimumVersions: z.infer<typeof updateVersions>;
  mandatory: boolean;
  rollbackVersion: string | null;
  package: { url: string; sha256: string; sizeBytes: number };
}

export interface LiveUpdateDistribution {
  manifest(nowSeconds: number): LiveUpdateManifestPayload;
}

export class ConfiguredLiveUpdateDistribution implements LiveUpdateDistribution {
  private readonly configured: LiveUpdateRelease;
  constructor(configured: LiveUpdateRelease) {
    const origin = publicReleaseOrigin(configured.origin);
    const parsed = liveUpdateReleaseSchema.safeParse(configured.release);
    if (!origin || !parsed.success) throw new Error("live_update_release_invalid");
    // zod clones the input. Freeze that copy so a caller cannot alter a trusted
    // origin/version/hash through an alias between validation and signing.
    Object.freeze(parsed.data.versions); Object.freeze(parsed.data.minimumVersions); Object.freeze(parsed.data.package);
    this.configured = Object.freeze({ origin, release: Object.freeze(parsed.data) });
  }
  manifest(nowSeconds: number): LiveUpdateManifestPayload {
    if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) throw new Error("live_update_clock_invalid");
    const { release, origin } = this.configured;
    return { v: 2, issuedAt: nowSeconds, expiresAt: nowSeconds + LIVE_UPDATE_MANIFEST_SECONDS,
      versions: { ...release.versions }, minimumVersions: { ...release.minimumVersions },
      mandatory: release.mandatory, rollbackVersion: release.rollbackVersion,
      package: { url: `${origin}/viralflow/ai-live/releases/${release.versions.agent}/package.zip`,
        sha256: release.package.sha256, sizeBytes: release.package.sizeBytes } };
  }
}

export function createLiveUpdateManifest(distribution: LiveUpdateDistribution, signing: LiveSigningConfiguration, nowSeconds: number) {
  // A modern manifest always authenticates keyId as well as the signed payload.
  if (!signing.keyId) throw new Error("live_update_rotation_not_configured");
  return signLiveEnvelope({ ...distribution.manifest(nowSeconds) }, signing);
}
