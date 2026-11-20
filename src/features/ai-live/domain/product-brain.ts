import type { LiveProduct } from "./types";

export interface ProductBrainOptions {
  now?: () => number;
  minDwellMs?: number;
  ctaCooldownMs?: number;
  recentWindow?: number;
}

/** Selection policy over existing ViralFlow products. It never creates product records. */
export class ProductBrain {
  private products: LiveProduct[] = [];
  private currentId: string | null = null;
  private readonly now: () => number;
  private readonly minDwellMs: number;
  private readonly ctaCooldownMs: number;
  private readonly recentWindow: number;
  private lastRotationAt: number;
  private lastCtaAt: number;
  private history: string[] = [];

  constructor(products: LiveProduct[], options: ProductBrainOptions = {}) {
    this.now = options.now ?? Date.now;
    this.minDwellMs = Math.max(0, options.minDwellMs ?? 60_000);
    this.ctaCooldownMs = Math.max(1_000, options.ctaCooldownMs ?? 120_000);
    this.recentWindow = Math.max(1, options.recentWindow ?? 2);
    this.lastRotationAt = this.now();
    this.lastCtaAt = this.now();
    this.setProducts(products);
  }

  setProducts(products: LiveProduct[]): void {
    const seen = new Set<string>();
    this.products = products.filter((product) => {
      if (!product.id || product.status !== "available" || seen.has(product.id)) return false;
      seen.add(product.id);
      return true;
    });
    if (!this.products.some((product) => product.id === this.currentId)) {
      this.currentId = this.products[0]?.id ?? null;
      this.lastRotationAt = this.now();
      this.lastCtaAt = this.now();
      this.history = this.currentId ? [this.currentId] : [];
    }
  }

  current(): LiveProduct | null {
    return this.products.find((product) => product.id === this.currentId) ?? null;
  }

  select(productId: string, atMs = this.now()): LiveProduct | null {
    const product = this.products.find((candidate) => candidate.id === productId);
    if (!product) return null;
    if (this.currentId !== productId) this.recordSelection(productId, atMs);
    return product;
  }

  /** Returns null when no safe change is due; it never rotates to the same product. */
  rotate(atMs = this.now()): LiveProduct | null {
    if (this.products.length < 2 || atMs - this.lastRotationAt < this.minDwellMs) return null;
    const recent = new Set(this.history.slice(-Math.min(this.recentWindow, this.products.length - 1)));
    const candidate = this.products.find((product) => product.id !== this.currentId && !recent.has(product.id))
      ?? this.products.find((product) => product.id !== this.currentId);
    if (!candidate) return null;
    this.recordSelection(candidate.id, atMs);
    return candidate;
  }

  /** Consumes the due CTA so repeated scheduler ticks cannot emit it twice. */
  takeCtaDue(atMs = this.now()): boolean {
    if (!this.current() || atMs - this.lastCtaAt < this.ctaCooldownMs) return false;
    this.lastCtaAt = atMs;
    return true;
  }

  private recordSelection(productId: string, atMs: number): void {
    this.currentId = productId;
    this.lastRotationAt = atMs;
    this.lastCtaAt = atMs;
    this.history.push(productId);
    if (this.history.length > Math.max(this.products.length, this.recentWindow + 1)) {
      this.history.splice(0, this.history.length - Math.max(this.products.length, this.recentWindow + 1));
    }
  }
}
