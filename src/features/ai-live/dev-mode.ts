/** Explicit local proof mode. A production environment can never enable it. */
export function devFallbackEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.NODE_ENV !== 'production' && environment.APP_ENV !== 'production'
    && environment.VERCEL_ENV !== 'production' && environment.AI_LIVE_ENV !== 'production' && !environment.VERCEL
    && environment.AI_LIVE_DEV_FALLBACK === 'true' && environment.PRESENTER_PROVIDER === 'dev_fallback';
}
