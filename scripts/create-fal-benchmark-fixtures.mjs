import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdir, readFile, stat, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {dirname, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

// Local artwork only: this script neither loads secret files nor calls a provider.
const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..");
const assetsDirectory = resolve(repoRoot, "benchmark-assets");
const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
const sharp = nextRequire("sharp");
const ffmpeg = require("ffmpeg-static");
const ffprobe = require("ffprobe-static").path;
const manifestPath = resolve(repoRoot, "benchmarks/fal-commerce-fixtures.json");
const sourcePath = resolve(assetsDirectory, "fal-packaging-carton.svg");
const rasterPath = resolve(assetsDirectory, "fal-packaging-carton.png");
const cartonPath = resolve(assetsDirectory, "fal-packaging-carton.jpg");
const creationPath = resolve(assetsDirectory, "fal-commerce-creation-manifest.json");
const width = 1254;
const height = 1254;

// Fixed native vector geometry and text make the fictional source reproducible.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1254 1254">
  <defs>
    <linearGradient id="backdrop" x2="0" y2="1"><stop stop-color="#f8f7f3"/><stop offset="1" stop-color="#e9e6df"/></linearGradient>
    <linearGradient id="front" x2="1" y2="0"><stop stop-color="#f3eddc"/><stop offset=".5" stop-color="#fffaed"/><stop offset="1" stop-color="#ede5d0"/></linearGradient>
    <linearGradient id="side" x2="1" y2="0"><stop stop-color="#ca6335"/><stop offset="1" stop-color="#ad4926"/></linearGradient>
    <linearGradient id="top" x2="0" y2="1"><stop stop-color="#fffdf3"/><stop offset="1" stop-color="#e8dfc8"/></linearGradient>
    <radialGradient id="shadow"><stop stop-color="#37382f" stop-opacity=".24"/><stop offset="1" stop-color="#37382f" stop-opacity="0"/></radialGradient>
    <clipPath id="frontClip"><path d="M330 304H760V1040H330Z"/></clipPath>
  </defs>
  <rect width="1254" height="1254" fill="url(#backdrop)"/>
  <ellipse cx="646" cy="1061" rx="437" ry="90" fill="url(#shadow)"/>
  <path d="M760 304L909 233V969L760 1040Z" fill="url(#side)" stroke="#a34a2b" stroke-width="2"/>
  <path d="M330 304L479 233H909L760 304Z" fill="url(#top)" stroke="#d7cdb5" stroke-width="2"/>
  <path d="M330 304H760V1040H330Z" fill="url(#front)" stroke="#d2c7af" stroke-width="2"/>
  <path d="M341 317H747" stroke="#fffdf5" stroke-width="3"/>
  <path d="M760 304V1040" stroke="#e9cc9f" stroke-width="3"/>
  <path d="M493 244H868" stroke="#e0d6bf" stroke-width="2"/>
  <g font-family="Arial, Helvetica, sans-serif" fill="#1d303b" clip-path="url(#frontClip)">
    <path d="M376 364L400 340L424 364L400 388Z" fill="#c45e32"/>
    <path d="M390 352V372L400 379L410 372V352" fill="none" stroke="#fff9ec" stroke-width="3"/>
    <text x="443" y="376" font-size="30" font-weight="700" letter-spacing="2">VF PANTRY</text>
    <path d="M374 420H715" stroke="#c45e32" stroke-width="3"/>
    <text x="374" y="491" font-size="56" font-weight="700" letter-spacing="2">COCOA</text>
    <text x="374" y="554" font-size="56" font-weight="700" letter-spacing="2">OAT BITES</text>
    <text x="376" y="600" font-size="23" letter-spacing="4">BOX P-04</text>
    <rect x="374" y="638" width="341" height="150" rx="3" fill="#1d303b"/>
    <path d="M409 713L437 668L465 713L437 758Z" fill="none" stroke="#e4a26b" stroke-width="3"/>
    <path d="M423 713L437 692L451 713L437 734Z" fill="#e4a26b"/>
    <text x="485" y="710" font-size="24" font-weight="700" fill="#fff9ec">12 PIECES</text>
    <text x="485" y="747" font-size="17" letter-spacing="1" fill="#fff9ec">SEALED CARTON</text>
    <text x="376" y="842" font-size="25" font-weight="700">NET WT 180 g</text>
    <text x="376" y="885" font-size="19" letter-spacing="1">FICTIONAL TEST PRODUCT</text>
    <path d="M374 916H715" stroke="#c8b89e" stroke-width="2"/>
    <text x="376" y="949" font-size="16">ARTWORK FOR MOTION TESTS</text>
    <text x="376" y="977" font-size="16">LOT VF-001</text>
    <text x="376" y="1005" font-size="14">NO PRODUCT INSIDE</text>
  </g>
  <g transform="matrix(1 -.476 0 1 760 304)" font-family="Arial, Helvetica, sans-serif" fill="#fff7e8">
    <text x="19" y="75" font-size="15" font-weight="700">VF PANTRY</text>
    <path d="M18 99H130" stroke="#f0bb8b" stroke-width="2"/>
    <text x="19" y="135" font-size="13">BOX P-04</text>
    <text x="19" y="169" font-size="13">12 PIECES</text>
    <text x="19" y="203" font-size="13">180 g</text>
    <path d="M19 243H128M19 270H128M19 297H128" stroke="#e59566" stroke-width="2"/>
    <text x="19" y="340" font-size="12">TEST CARTON</text>
    <text x="19" y="368" font-size="12">LOT VF-001</text>
    <rect x="19" y="508" width="111" height="86" fill="#fff7e8"/>
    <path d="M26 516V582M30 516V582M37 516V582M46 516V582M50 516V582M58 516V582M69 516V582M74 516V582M80 516V582M89 516V582M94 516V582M105 516V582M113 516V582M120 516V582" stroke="#25363a" stroke-width="3"/>
    <text x="22" y="624" font-size="11">P04-TEST-001</text>
  </g>
  <g transform="matrix(1 0 -2.0986 1 479 233)" font-family="Arial, Helvetica, sans-serif" fill="#32414a">
    <text x="30" y="45" font-size="19" font-weight="700" letter-spacing="2">VF PANTRY</text>
    <text x="283" y="45" font-size="16">P-04</text>
  </g>
</svg>
`;

const relativePath = (path) => relative(repoRoot, path).split(sep).join("/");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function inspectImage(path, provenance) {
  const [bytes, fileInfo] = await Promise.all([readFile(path), stat(path)]);
  const probe = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,pix_fmt", "-of", "json", path], {encoding: "utf8"}));
  const stream = probe.streams[0];
  if (!stream || stream.width !== width || stream.height !== height) {
    throw new Error(`Fixture dimensions must be ${width} x ${height}: ${relativePath(path)}`);
  }
  return {path: relativePath(path), sha256: hash(bytes), bytes: fileInfo.size, width: stream.width, height: stream.height, pixelFormat: stream.pix_fmt, provenance};
}

await mkdir(assetsDirectory, {recursive: true});
await writeFile(sourcePath, svg, "utf8");
await sharp(Buffer.from(svg)).png({compressionLevel: 9, adaptiveFiltering: false}).toFile(rasterPath);
execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-fflags", "+bitexact", "-i", rasterPath, "-frames:v", "1", "-map_metadata", "-1", "-flags:v", "+bitexact", "-q:v", "2", "-pix_fmt", "yuvj444p", "-threads", "1", "-update", "1", cartonPath], {stdio: "pipe"});

const fixtureBytes = await readFile(manifestPath);
const fixtures = JSON.parse(fixtureBytes.toString("utf8"));
if (!Array.isArray(fixtures) || fixtures.length !== 3) throw new Error("Exactly three commerce fixtures are required");
const images = [];
for (const fixture of fixtures) {
  if (fixture.renderInput.overlay.length !== 0) throw new Error(`Fixture must have no overlays: ${fixture.id}`);
  const imagePath = resolve(repoRoot, fixture.imagePath);
  if (!imagePath.startsWith(`${assetsDirectory}${sep}`)) throw new Error("Fixture images must remain inside benchmark-assets");
  const image = await inspectImage(imagePath, fixture.id === "packaging" ? "Deterministic fictional native SVG rasterized locally with installed Sharp and exported to JPG by installed FFmpeg" : "Existing local benchmark JPG reused byte-for-byte; no raster edits");
  images.push({...image, fixtureId: fixture.id, promptSha256: hash(fixture.prompt)});
}

const creationManifest = {
  schemaVersion: 1,
  purpose: "No-cost local inputs for identical image/prompt comparisons across fal commerce benchmark models",
  method: "Fixed native SVG artwork -> installed Next-local Sharp PNG rasterization -> installed FFmpeg JPEG export. Existing beauty and gadget JPGs are read only.",
  externalCalls: 0,
  generationCostUsd: 0,
  fixturesManifest: {path: relativePath(manifestPath), sha256: hash(fixtureBytes)},
  creator: {path: relativePath(scriptPath), sha256: hash(await readFile(scriptPath))},
  runtimes: {node: process.version, sharp: sharp.versions.sharp, ffmpeg: execFileSync(ffmpeg, ["-version"], {encoding: "utf8"}).split(/\r?\n/)[0]},
  source: {path: relativePath(sourcePath), sha256: hash(await readFile(sourcePath)), width, height, type: "native-svg", product: "Fictional VF PANTRY COCOA OAT BITES carton"},
  rasterizationIntermediate: await inspectImage(rasterPath, "Locally rasterized native SVG; newly created image"),
  comparisonPolicy: {sameImagePerFixtureAcrossModels: true, samePromptPerFixtureAcrossModels: true, overlays: false, targetSeconds: 8},
  fixtures: images,
};
await writeFile(creationPath, `${JSON.stringify(creationManifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({fixtureManifest: relativePath(manifestPath), creationManifest: relativePath(creationPath), images}, null, 2));
