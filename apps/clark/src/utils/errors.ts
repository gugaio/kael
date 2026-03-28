export interface SerializedError {
  code: string;
  message: string;
  details?: unknown;
}

export class ClarkError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ClarkError';
  }
}

export function serializeError(error: unknown, fallbackCode = 'internal_error'): SerializedError {
  if (error instanceof ClarkError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      code: fallbackCode,
      message: error.message,
    };
  }

  return {
    code: fallbackCode,
    message: 'Unknown error',
    details: error,
  };
}
