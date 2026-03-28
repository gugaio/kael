import { calculateBackoffDelay } from '../core/backoff.js';

describe('backoff', () => {
  it('caps backoff at max delay', () => {
    expect(calculateBackoffDelay(0, 1000, 5000)).toBe(1000);
    expect(calculateBackoffDelay(3, 1000, 5000)).toBe(5000);
  });
});
