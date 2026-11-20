export type LivePolicyReason = "DISCLOSURE_REQUIRED" | "PROHIBITED_PRODUCT" | "UNSAFE_CLAIM"
  | "MISLEADING_IDENTITY" | "REGION_RESTRICTED" | "PLATFORM_UNAVAILABLE";

export interface LivePolicyConfiguration {
  platformPermitted: boolean;
  region: string;
  allowedRegions: string[] | null;
  aigcDisclosureRequired: boolean;
  aigcDisclosureSupported: boolean;
  aigcDisclosureAccepted: boolean;
  prohibitedProductIds: string[];
  unsafeClaimPatterns: RegExp[];
}

export interface LivePolicyInput {
  text: string;
  productId: string | null;
  representsRealPerson: boolean;
  identityConsentConfirmed: boolean;
  impersonationClaim: boolean;
}

/** Safety policy is supplied by the approved transport/region; it cannot grant platform eligibility. */
export class LivePolicyGuard {
  constructor(private readonly config: LivePolicyConfiguration) {}

  evaluate(input: LivePolicyInput): { allowed: boolean; reasons: LivePolicyReason[] } {
    const reasons: LivePolicyReason[] = [];
    if (!this.config.platformPermitted) reasons.push("PLATFORM_UNAVAILABLE");
    if (this.config.allowedRegions && !this.config.allowedRegions.includes(this.config.region)) reasons.push("REGION_RESTRICTED");
    if (this.config.aigcDisclosureRequired && (!this.config.aigcDisclosureSupported || !this.config.aigcDisclosureAccepted)) reasons.push("DISCLOSURE_REQUIRED");
    if (input.productId && this.config.prohibitedProductIds.includes(input.productId)) reasons.push("PROHIBITED_PRODUCT");
    if (this.config.unsafeClaimPatterns.some((pattern) => {
      // Avoid stateful /g and /y behavior causing an unsafe claim to pass on the second call.
      const safe = new RegExp(pattern.source, pattern.flags.replace(/[gy]/gu, ""));
      return safe.test(input.text);
    })) reasons.push("UNSAFE_CLAIM");
    if (input.impersonationClaim || (input.representsRealPerson && !input.identityConsentConfirmed)) reasons.push("MISLEADING_IDENTITY");
    return { allowed: reasons.length === 0, reasons };
  }
}
