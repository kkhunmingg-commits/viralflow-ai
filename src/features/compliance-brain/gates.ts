import type { ComplianceAuthority, ComplianceDecision, ComplianceInput } from "./contracts";
import { contentHash } from "./engine";

export const passesCompliance = (decision: ComplianceDecision) => ["PASS", "PASS_WITH_WARNING"].includes(decision.status);
export async function evaluateWithBoundedRewrite(authority: ComplianceAuthority, original: ComplianceInput,
  maxAttempts = 2, signal?: AbortSignal): Promise<{ input: ComplianceInput; decision: ComplianceDecision }> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 2) throw new Error("compliance_rewrite_limit");
  let input = original, decision = await authority.evaluate(input, signal);
  const trace: ComplianceDecision["rewrites"] = [];
  for (let attempt = 0; attempt < maxAttempts && decision.status === "AUTO_REWRITE"; attempt++) {
    if (!decision.suggestedRewrite) break;
    const next = { ...input, content: decision.suggestedRewrite };
    if (contentHash(next.content) === contentHash(input.content)) break;
    const rescanned = await authority.evaluate(next, signal);
    trace.push({ inputHash: decision.contentHash, outputHash: rescanned.contentHash, status: rescanned.status });
    input = next; decision = rescanned;
  }
  if (decision.status === "AUTO_REWRITE") decision = { ...decision, status: "REVIEW_REQUIRED", suggestedRewrite: null };
  return { input, decision: { ...decision, rewrites: trace } };
}
export class PublishGate {
  constructor(private readonly authority: ComplianceAuthority) {}
  async check(input: ComplianceInput) {
    // Rewriting media metadata at the last boundary cannot alter the already generated video.
    const decision = await this.authority.evaluate({ ...input, scope: { ...input.scope, channel: "POST" }, stage: "FINAL_PUBLISH" });
    return { allowed: passesCompliance(decision), decision };
  }
}
export class LiveSpeechGate {
  constructor(private readonly authority: ComplianceAuthority,
    private readonly context: () => Omit<ComplianceInput, "content" | "stage">, private readonly maxRewriteAttempts = 2) {}
  async authorize(text: string, signal?: AbortSignal) {
    const context=this.context();
    const evaluated = await evaluateWithBoundedRewrite(this.authority,
      { ...context, scope:{...context.scope,channel:"LIVE"}, stage: "LIVE_SPEECH", content: { script: text } }, this.maxRewriteAttempts, signal);
    return { allowed: passesCompliance(evaluated.decision), text: evaluated.input.content.script ?? "", decision: evaluated.decision };
  }
}
