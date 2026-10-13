import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeCreativeLearning } from "../src/features/analytics/creative-learning";
import { assertHumanProductionReview, planCreativeStrategy, type CreativeStrategyPlan } from "../src/features/creative/strategist";
import { analyzeTrendIntelligence } from "../src/features/growth-manager/topics";
import { createGoogleTrendsThailandSource, GOOGLE_TRENDS_TH_RSS, type GoogleTrendsFeed } from "../src/features/growth-manager/trend-source";

/** Local planner proof only. No env loader, database, account tokens, provider or publishing client. */
async function main() {
  const args = process.argv.slice(2), referenceArgs = args.filter(arg => arg.startsWith("--reference="));
  const liveTrends = args.includes("--live-trends");
  assert(args.every(arg => arg === "--live-trends" || arg.startsWith("--reference=")) &&
    referenceArgs.length <= 1 && args.filter(arg => arg === "--live-trends").length <= 1,
  "Supported arguments: --live-trends and --reference=absoluteLocalPath (once each)");
  const now = new Date(), originalFetch = globalThis.fetch;
  const counters = { publicSourceRequests: 0, blockedUnexpectedRequests: 0, paidGenerationCalls: 0, tikTokCalls: 0 };
  const outputDirectory = path.resolve(".video-benchmark/viral-intelligence-20261013");
  const ownerReference = referenceArgs.length ? referenceArgs[0].slice("--reference=".length)
    : path.resolve("benchmark-assets/owner-mechanism-reference.mp4");
  assert(path.isAbsolute(ownerReference) && !/^(?:\\\\|\/\/)/.test(ownerReference), "Reference must be an absolute local file path");
  globalThis.fetch = async () => { counters.blockedUnexpectedRequests++; throw new Error("UNEXPECTED_NETWORK_CALL_BLOCKED"); };
  const publicFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert(liveTrends && url === GOOGLE_TRENDS_TH_RSS && init?.method === "GET", "Only the fixed public trends RSS is allowed");
    assert(init.credentials === "omit" && init.redirect === "error", "Public source must not forward credentials or follow redirects");
    counters.publicSourceRequests++;
    return originalFetch(input, init);
  };
  try {
    const source = liveTrends ? await createGoogleTrendsThailandSource(publicFetch).read(now) : null;
    const trends = analyzeTrendIntelligence(source?.observations ?? [], { accountId: "local-growth-review-only", region: "TH" }, now);
    let referenceMetadata: { exists: boolean; bytes: number | null; sha256: string | null };
    try {
      const metadata = await stat(ownerReference);
      referenceMetadata = { exists: metadata.isFile(), bytes: metadata.size,
        sha256: createHash("sha256").update(await readFile(ownerReference)).digest("hex") };
    } catch { referenceMetadata = { exists: false, bytes: null, sha256: null }; }
    const mechanism = planCreativeStrategy({ now,
      account: { id: "local-mop-review-only", mode: "AFFILIATE", affiliateEligible: null },
      product: { id: "local-product-identity-unverified", title: "ถังปั่นไม้ถูพื้น — ตัวอย่างที่ยังไม่ยืนยันสินค้าจริง", mechanism: "COMPLEX" },
      facts: [], assets: [{ id: "owner-unverified-reference", kind: "REAL_FOOTAGE", source: "OWNER",
        reference: ownerReference, rightsConfirmed: false, reviewed: false, productId: "local-product-identity-unverified" }], costs: [] });
    const growth = planCreativeStrategy({ now,
      account: { id: "local-growth-review-only", mode: "GROWTH", affiliateEligible: false },
      facts: [], assets: [], trends, costs: [] });
    const learning = analyzeCreativeLearning([], { ownerId: "local-verification-only", accountId: "local-growth-review-only",
      mode: "GROWTH", optedIn: false, affiliateEligible: false }, now);

    const functionalChecks: string[] = [];
    for (const [name, plan] of [["complex-mechanism", mechanism], ["growth", growth]] as const) {
      assert(plan.concepts.length >= 3, "At least three concepts are required");
      assert(plan.predictedVirality === "UNKNOWN" && plan.humanReviewRequired, "Creative outcome cannot be certified by tests");
      for (const concept of plan.concepts) {
        const scenes = concept.concept.scenePlan;
        assert.equal(scenes[0].start, 0);
        assert(scenes.at(-1)!.end >= 8 && scenes.at(-1)!.end <= 10);
        assert(scenes.every((scene, index) => scene.end > scene.start && (index === 0 || scene.start === scenes[index - 1].end)));
        assert.equal(concept.cost.totalActualThb, null, "Missing invoice cannot become zero actual cost");
        assert.equal(concept.cost.targetMet, null, "No usable-cost claim without verified billing and output review");
      }
      assert.throws(() => assertHumanProductionReview(plan), /HUMAN_CREATIVE_REVIEW_REQUIRED/);
      functionalChecks.push(`${name}: three 8–10-second storyboard contracts, unknown actual cost and review gate PASS`);
    }
    assert(mechanism.concepts.every(concept => concept.production.method === "WAIT_FOR_EVIDENCE" && !concept.production.ready));
    assert.equal(mechanism.analysis.mechanismRisk, "REAL_FOOTAGE_REQUIRED");
    assert.equal(growth.trendStatus, "UNKNOWN", "A real Google search topic does not establish this account's TikTok audience or growth");
    assert(growth.concepts.every(concept => !/กดตะกร้า|สั่งซื้อ|ช้อปเลย|รับคอมมิชชั่น/.test(concept.concept.cta)));
    assert.equal(learning.status, "UNKNOWN");
    assert.equal(learning.sampleSize, 0);
    assert.equal(learning.rulesActivated, false);
    assert.equal(counters.paidGenerationCalls, 0);
    assert.equal(counters.tikTokCalls, 0);
    assert.equal(counters.blockedUnexpectedRequests, 0);
    functionalChecks.push("Unverified owner example is excluded as product evidence; no mechanism generation permitted");
    functionalChecks.push("No real account analytics fabricated; no learned rule activation, paid call or TikTok call");

    const report = { generatedAt: now.toISOString(), mode: liveTrends ? "LOCAL_WITH_PUBLIC_RSS" : "LOCAL_OFFLINE",
      scope: "Planner and evidence gates only; not video quality, production readiness or virality certification",
      humanReview: { status: "PENDING", creativeQuality: "PENDING", factualAccuracy: "PENDING", mediaRights: "PENDING" },
      source: source ?? { status: "UNKNOWN", reason: "OFFLINE_NO_SOURCE_FETCHED" }, trends,
      ownerReference: { path: ownerReference, ...referenceMetadata, classification: "UNVERIFIED_REFERENCE_NOT_PRODUCT_EVIDENCE",
        actualProductIdentity: "UNKNOWN", actualPdpEvidence: "UNKNOWN", syntheticOrRealOrigin: "UNKNOWN" },
      cases: { complexMechanism: mechanism, growth }, learning, counters, functionalChecks,
      cost: { actualInvoice: "UNKNOWN", usableCostThb: null, targetThb: 5, targetMet: null,
        note: "No video is produced in this run. All costs, including labor/runtime and failed generations, need verified records before claiming <=5 THB." },
      restrictions: { productionChanged: false, databaseAccess: false, envLoaded: false, realAccountAccess: false,
        paidVideoGeneration: false, autoPosting: false } };
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(path.join(outputDirectory, "manifest.json"), JSON.stringify(report, null, 2) + "\n");
    await writeFile(path.join(outputDirectory, "CREATIVE_REVIEW.md"), renderReport(now, source, mechanism, growth, functionalChecks));
    process.stdout.write(JSON.stringify({ status: "FUNCTIONAL_GATES_PASS_HUMAN_REVIEW_PENDING", conceptsPerCase: 3,
      publicSourceStatus: source?.status ?? "UNKNOWN", accountApplicableTrendStatus: trends.status,
      humanReview: "PENDING", counters, artifacts: [path.join(outputDirectory, "manifest.json"), path.join(outputDirectory, "CREATIVE_REVIEW.md")] }, null, 2) + "\n");
  } finally { globalThis.fetch = originalFetch; }
}

function renderPlan(label: string, plan: CreativeStrategyPlan) {
  const selected = plan.concepts.find(concept => concept.id === plan.selectedConceptId)!;
  const lines = [`## ${label}`, "", `Provisional selected concept: **${selected.concept.title}**`, "",
    `Production gate: ${selected.production.method}. Human creative/factual/media review: **PENDING**.`, "",
    `Selection is an inspectable evidence/feasibility rubric (${selected.score}); it is not a viral-success probability.`, "",
    `Audience: ${plan.analysis.audience.status} — ${plan.analysis.audience.basis}`, "",
    `Trend suitability for this account: ${plan.trendStatus}. Topic: ${plan.topic ?? "UNKNOWN — only generic experiment hypotheses are possible"}.`, "",
    ...selected.reasons.map(reason => `- ${reason}`), ""];
  for (const [index, row] of plan.concepts.entries()) {
    lines.push(`### Concept ${index + 1}: ${row.concept.title}`, "", `Hook: ${row.concept.hook}`, "",
      `Script: ${row.concept.voiceScript}`, "", `Production: ${row.production.method}; status: ${row.status}.`, "",
      "| Time | Visual / evidence | Movement |", "| --- | --- | --- |");
    for (const scene of row.concept.scenePlan) lines.push(`| ${scene.start}–${scene.end}s | ${scene.visual.replaceAll("|", "/")} | ${scene.motion.replaceAll("|", "/")} |`);
    lines.push("", `Required evidence: ${row.production.missingEvidence.join("; ") || "Evidence gate satisfied; human review still required"}.`, "",
      "Cost estimate: UNKNOWN. Actual usable cost: UNKNOWN; billing, failed attempts, local runtime and labor have not been established.", "");
  }
  return lines.join("\n");
}

function renderReport(now: Date, source: GoogleTrendsFeed | null, mechanism: CreativeStrategyPlan,
  growth: CreativeStrategyPlan, functionalChecks: string[]) {
  return ["# Viral intelligence — local human review packet", "", `Generated: ${now.toISOString()}`, "",
    "**Functional checks are not creative-quality approval. Human review remains PENDING for every concept. No video was generated or published.**", "",
    "The owner mop clip is an unverified reference. Its product identity, filming/generation origin and media rights are unknown; no PDP or claim evidence is available.", "",
    source?.status === "REAL_OBSERVATIONS"
      ? `Real source: [Google Trends Thailand official RSS](${source.sourceUrl}), fetched ${source.fetchedAt}; ${source.observations.length} observations. ${source.attribution}. Google search interest is not TikTok views, audience fit or virality.`
      : "Current trend source: UNKNOWN. No mock trend has been substituted; concepts are experiment hypotheses.", "",
    renderPlan("A. Complex mechanism — spin mop", mechanism), "",
    renderPlan("B. Growth account — no commerce", growth), "", "## Functional evidence gates", "",
    ...functionalChecks.map(check => `- ${check}`), "",
    "## Owner review required", "",
    "- Confirm whether the mop reference depicts the actual product and supply permitted product footage/PDP before production.",
    "- Review creative appeal, script accuracy and media rights. A test pass cannot make those judgments.",
    "- Supply actual invoices and reviewed usable outputs before treating the <=5 THB goal as achieved.",
    "- Google Vids remains assisted; no session sharing, paid fallback, TikTok posting or real account access occurs in this proof.", ""].join("\n");
}

main().catch(error => { process.stderr.write(`VIRAL_INTELLIGENCE_VERIFICATION_FAILED: ${error instanceof Error ? error.message : "UNKNOWN"}\n`); process.exitCode = 1; });
