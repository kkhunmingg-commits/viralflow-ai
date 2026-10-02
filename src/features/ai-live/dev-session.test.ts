import { describe, expect, it } from 'vitest';
import { waitForDevRelease } from './dev-session';

describe('actual DEV resource release', () => {
  it('waits for both terminal status and completed release after stop acknowledgement', async () => {
    const states = [{status: 'STOPPED', resources_released: false}, {status: 'STOPPED', resources_released: true}];
    let reads = 0;
    const result = await waitForDevRelease({status: 'STOPPING', resources_released: false}, async () => states[reads++], {wait: async () => {}});
    expect(reads).toBe(2);
    expect(result.resources_released).toBe(true);
  });
  it('bounds waiting and refuses to report a stuck kernel as released', async () => {
    let now = 0;
    await expect(waitForDevRelease({status: 'STOPPING', resources_released: false}, async () => ({status: 'STOPPING', resources_released: false}),
      {now: () => now, wait: async () => { now += 10; }, timeoutMs: 20})).rejects.toThrow('คืนทรัพยากรไม่ครบ');
  });
});
