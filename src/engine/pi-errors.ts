export type PiErrorCode =
  | "timeout"
  | "rate_limit"
  | "auth"
  | "provider_unavailable"
  | "network"
  | "invalid_response"
  | "unknown";

export class PiEngineError extends Error {
  readonly code: PiErrorCode;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(params: {
    message: string;
    code: PiErrorCode;
    retryable: boolean;
    statusCode?: number;
  }) {
    super(params.message);
    this.name = "PiEngineError";
    this.code = params.code;
    this.retryable = params.retryable;
    this.statusCode = params.statusCode;
  }
}

export function normalizePiError(error: unknown): PiEngineError {
  if (error instanceof PiEngineError) {
    return error;
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return new PiEngineError({
      message: "Pi engine request timed out",
      code: "timeout",
      retryable: true,
    });
  }

  if (error instanceof TypeError) {
    return new PiEngineError({
      message: `Pi engine network error: ${error.message}`,
      code: "network",
      retryable: true,
    });
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("rate limit") || message.includes("429")) {
      return new PiEngineError({
        message: error.message,
        code: "rate_limit",
        retryable: true,
      });
    }
    if (
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("request ended without sending any chunks")
    ) {
      return new PiEngineError({
        message: error.message,
        code: "timeout",
        retryable: true,
      });
    }
    if (
      message.includes("unauthorized") ||
      message.includes("authentication") ||
      message.includes("invalid api key") ||
      message.includes("401") ||
      message.includes("403")
    ) {
      return new PiEngineError({
        message: error.message,
        code: "auth",
        retryable: false,
      });
    }
    if (message.includes("network") || message.includes("econn") || message.includes("fetch")) {
      return new PiEngineError({
        message: error.message,
        code: "network",
        retryable: true,
      });
    }
    if (
      message.includes("unavailable") ||
      message.includes("overloaded") ||
      message.includes("503") ||
      message.includes("502")
    ) {
      return new PiEngineError({
        message: error.message,
        code: "provider_unavailable",
        retryable: true,
      });
    }
    return new PiEngineError({
      message: error.message,
      code: "unknown",
      retryable: false,
    });
  }

  return new PiEngineError({
    message: "Pi engine unknown error",
    code: "unknown",
    retryable: false,
  });
}

export function classifyHttpError(statusCode: number, detail: string): PiEngineError {
  if (statusCode === 401 || statusCode === 403) {
    return new PiEngineError({
      message: `Pi engine auth error: ${detail}`,
      code: "auth",
      retryable: false,
      statusCode,
    });
  }

  if (statusCode === 429) {
    return new PiEngineError({
      message: `Pi engine rate limit: ${detail}`,
      code: "rate_limit",
      retryable: true,
      statusCode,
    });
  }

  if (statusCode >= 500) {
    return new PiEngineError({
      message: `Pi engine unavailable: ${detail}`,
      code: "provider_unavailable",
      retryable: true,
      statusCode,
    });
  }

  return new PiEngineError({
    message: `Pi engine HTTP error (${statusCode}): ${detail}`,
    code: "unknown",
    retryable: false,
    statusCode,
  });
}

export function shouldFallbackOnPiError(error: unknown): boolean {
  const normalized = normalizePiError(error);
  return (
    normalized.code === "timeout" ||
    normalized.code === "rate_limit" ||
    normalized.code === "provider_unavailable" ||
    normalized.code === "network"
  );
}
