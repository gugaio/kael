export function calculateBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const raw = baseDelayMs * (2 ** Math.max(0, attempt));
  return Math.min(raw, maxDelayMs);
}
