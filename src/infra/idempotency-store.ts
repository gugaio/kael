type IdempotencyCacheEntry<T> = {
  signature: string;
  value: T;
  expiresAt: number;
};

export class IdempotencyConflictError extends Error {
  constructor() {
    super("idempotency key reused with different request payload");
    this.name = "IdempotencyConflictError";
  }
}

export class IdempotencyStore {
  private readonly completed = new Map<string, IdempotencyCacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly ttlMs: number) {}

  async execute<T>(params: {
    key: string;
    signature: string;
    handler: () => Promise<T>;
  }): Promise<{ replayed: boolean; value: T }> {
    this.cleanupExpired();

    const completed = this.completed.get(params.key);
    if (completed) {
      if (completed.signature !== params.signature) {
        throw new IdempotencyConflictError();
      }
      return { replayed: true, value: completed.value as T };
    }

    const inFlight = this.inFlight.get(params.key);
    if (inFlight) {
      const value = (await inFlight) as T;
      return { replayed: true, value };
    }

    const promise = params
      .handler()
      .then((value) => {
        this.completed.set(params.key, {
          signature: params.signature,
          value,
          expiresAt: Date.now() + this.ttlMs,
        });
        return value;
      })
      .finally(() => {
        this.inFlight.delete(params.key);
      });

    this.inFlight.set(params.key, promise);
    const value = await promise;
    return { replayed: false, value };
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.completed.entries()) {
      if (entry.expiresAt <= now) {
        this.completed.delete(key);
      }
    }
  }
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
