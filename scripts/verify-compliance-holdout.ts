/** Reproducible no-network evaluation of cases frozen separately from the original regression corpus. */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ComplianceEngine } from "../src/features/compliance-brain/engine";
import { passesCompliance } from "../src/features/compliance-brain/gates";
import { HOLDOUT_SEMANTIC_CASES, holdoutInput } from "../src/features/compliance-brain/holdout-corpus";
import { createSignedPolicyTestFixture } from "../src/features/compliance-brain/policy-test-fixtures";
import { GroundedSemanticClassifier } from "../src/features/compliance-brain/semantic";

async function main() {
  const { payload } = createSignedPolicyTestFixture(), classifier = new GroundedSemanticClassifier();
  const engine = new ComplianceEngine({ policy: async () => payload, classifier });
  const records = [];
  for (const channel of ["POST", "LIVE"] as const) {
    for (const row of HOLDOUT_SEMANTIC_CASES) {
      const input = holdoutInput(row.text, row.category, channel, row.allowed ? row.text : undefined);
      const assessment = await classifier.classify(input), decision = await engine.evaluate(input);
      const recognizedRisks = [...new Set(assessment.findings.map(item => item.category).filter(category => category !== "UNKNOWN_FACT"))];
      records.push({ id: row.id, category: row.category, channel, text: row.text, approvedFixtureEvidence: row.allowed,
        expectedAllow: row.allowed, actualStatus: decision.status, actualAllow: passesCompliance(decision),
        recognizedRisks, unknownFact: assessment.findings.some(item => item.category === "UNKNOWN_FACT"),
        passed: passesCompliance(decision) === row.allowed });
    }
  }
  const unsupported = records.filter(row => !row.expectedAllow), permitted = records.filter(row => row.expectedAllow);
  const summary = { uniqueSentences: HOLDOUT_SEMANTIC_CASES.length, evaluations: records.length,
    unsupportedEvaluations: unsupported.length, unsupportedAllowed: unsupported.filter(row => row.actualAllow).length,
    unsupportedWithRecognizedRisk: unsupported.filter(row => row.recognizedRisks.length > 0).length,
    unsupportedHeldByGroundingOnly: unsupported.filter(row => row.recognizedRisks.length === 0 && row.unknownFact && !row.actualAllow).length,
    supportedEvaluations: permitted.length, supportedHeld: permitted.filter(row => !row.actualAllow).length,
    allExpectedBoundaryOutcomesPassed: records.every(row => row.passed) };
  const directory = resolve(process.cwd(), ".video-cache", "compliance-readiness"); await mkdir(directory, { recursive: true });
  const reportPath = join(directory, "semantic-holdout-report.json");
  await writeFile(reportPath, JSON.stringify({ schemaVersion: 1, evaluatedAt: new Date().toISOString(),
    fixturePolicyOnly: true, paidCalls: 0, networkCalls: 0, classifierModifiedForCases: false, summary, records,
    limitations: ["Evidence fixtures are synthetic verified facts, not customer product evidence",
      "Grounding-only holds do not demonstrate open-ended semantic risk recognition",
      "This small selected set is not a calibrated or representative production false-positive estimate",
      "Independent means absent from corpus.ts and frozen before this run; cases may become regressions in future"] }, null, 2));
  console.log(JSON.stringify({ reportPath, ...summary, paidCalls: 0 }));
  if (!summary.allExpectedBoundaryOutcomesPassed) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : "HOLDOUT_EVALUATION_FAILED"); process.exitCode = 1; });
