import { describe, expect, it } from 'vitest';
import { devFallbackEnabled } from './dev-mode';
import { LiveSessionController } from './session-controller';

describe('explicit DEV presenter boundary', () => {
  const enabled = {AI_LIVE_DEV_FALLBACK: 'true', PRESENTER_PROVIDER: 'dev_fallback', NODE_ENV: 'development', APP_ENV: 'development'};
  it('requires both explicit flags and refuses production even when enabled', () => {
    expect(devFallbackEnabled({})).toBe(false);
    expect(devFallbackEnabled({...enabled, AI_LIVE_DEV_FALLBACK: 'false'})).toBe(false);
    expect(devFallbackEnabled({...enabled, PRESENTER_PROVIDER: 'musetalk'})).toBe(false);
    expect(devFallbackEnabled({...enabled, NODE_ENV: 'production'})).toBe(false);
    expect(devFallbackEnabled({...enabled, APP_ENV: 'production'})).toBe(false);
    expect(devFallbackEnabled({...enabled, VERCEL_ENV: 'production'})).toBe(false);
    expect(devFallbackEnabled({...enabled, AI_LIVE_ENV: 'production'})).toBe(false);
    expect(devFallbackEnabled({...enabled, VERCEL: '1'})).toBe(false);
    expect(devFallbackEnabled(enabled)).toBe(true);
  });
  it('rejects an unconfigured dev runtime before invoking presenter or saving a session', async () => {
    let starts = 0;
    const controller = new LiveSessionController({kind: 'dev_fallback', health: async () => 'READY',
      start: async () => { starts++; }, pause: async () => {}, resume: async () => {}, stop: async () => {},
    }, {load: async () => null, save: async () => { throw new Error('must_not_save'); }});
    const previous = process.env.AI_LIVE_DEV_FALLBACK;
    delete process.env.AI_LIVE_DEV_FALLBACK;
    try {
      await expect(controller.start({ownerId: 'owner', tiktokAccountId: 'account', productIds: ['product'], presenterReferenceId: 'reference'})).rejects.toThrow('dev_presenter_forbidden');
      expect(starts).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.AI_LIVE_DEV_FALLBACK;
      else process.env.AI_LIVE_DEV_FALLBACK = previous;
    }
  });
});
