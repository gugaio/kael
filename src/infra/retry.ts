export type RetryPolicy = {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
};

export type RetryContext = {
  attempt: number;
  maxAttempts: number;
  error: unknown;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelayMs(policy: RetryPolicy, attempt: number): number {
  const exponential = policy.baseDelayMs * Math.pow(2, attempt - 1);
  const withCap = Math.min(exponential, policy.maxDelayMs);
  const jitter = policy.jitterMs > 0 ? Math.floor(Math.random() * policy.jitterMs) : 0;
  return withCap + jitter;
}

export async function retry<T>(
  operation: () => Promise<T>,
  policy: RetryPolicy,
  shouldRetry: (context: RetryContext) => boolean,
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(policy.attempts));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const canRetry = shouldRetry({ attempt, maxAttempts, error });
      if (!canRetry || attempt >= maxAttempts) {
        throw error;
      }
      await sleep(computeDelayMs(policy, attempt));
    }
  }

  throw new Error("retry exhausted unexpectedly");
}
