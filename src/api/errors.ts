import type { FastifyReply, FastifyRequest } from "fastify";
import { VideoJobValidationError } from "../video/safety.js";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function sendApiError(
  reply: FastifyReply,
  request: FastifyRequest,
  error: ApiError,
): FastifyReply {
  return reply.code(error.status).send({
    ok: false,
    error: {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
      requestId: request.id,
    },
  });
}

export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  if (error instanceof VideoJobValidationError) {
    return new ApiError(400, "BAD_REQUEST", error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ApiError(500, "INTERNAL_ERROR", "Internal server error", {
    cause: message,
  });
}
