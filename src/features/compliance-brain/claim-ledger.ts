import type { ComplianceScope, ProductClaim, ProductEvidence } from "./contracts";

// Keep numeric punctuation, units and signs: 10.5 must never become 105.
const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, "").replace(/[。!?]+$/u, "");
export const normalizeProposition = normalize;
const current = (expiry: string | null, now: number) => expiry === null || Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) > now;
export class EvidenceRegistry {
  constructor(private readonly scope: ComplianceScope, private readonly rows: ProductEvidence[], private readonly now: number) {}
  get(id: string) {
    return this.rows.find(row => row.id === id && row.ownerId === this.scope.ownerId && row.productId === this.scope.productId
      && row.verified && row.jurisdiction === this.scope.country && /^[a-f0-9]{64}$/i.test(row.sourceHash)
      && row.source.trim().length > 0 && current(row.expiresAt, this.now)) ?? null;
  }
}
export class ClaimLedger {
  readonly registry: EvidenceRegistry;
  constructor(private readonly scope: ComplianceScope, private readonly rows: ProductClaim[], evidence: ProductEvidence[],
    private readonly now: number = Date.now(), private readonly satisfiedConditions: readonly string[] = []) {
    this.registry = new EvidenceRegistry(scope, evidence, now);
  }
  permitted() {
    return this.rows.filter(row => row.ownerId === this.scope.ownerId && row.productId === this.scope.productId && row.verified
      && row.jurisdiction === this.scope.country && row.allowedChannels.includes(this.scope.channel) && current(row.expiresAt, this.now)
      && row.conditions.every(condition => this.satisfiedConditions.includes(condition))
      && row.evidenceRefs.length > 0 && row.evidenceRefs.every(ref => this.registry.get(ref)));
  }
  match(assertion: string) {
    const value = normalize(assertion);
    return this.permitted().filter(claim => [claim.text, ...(claim.aliases ?? [])].some(text => normalize(text) === value));
  }
  state(assertion: string): "VERIFIED" | "UNKNOWN" { return this.match(assertion).length ? "VERIFIED" : "UNKNOWN"; }
}
