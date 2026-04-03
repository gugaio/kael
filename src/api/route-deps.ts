import type { FastifyReply, FastifyRequest } from "fastify";
import type { KaelApp } from "../app.js";
import type { IdempotencyStore } from "../infra/idempotency-store.js";

export type RequestWithStart = FastifyRequest & {
  _kaelStartNs?: bigint;
};

export type ApiRouteDeps = {
  app: KaelApp;
  idempotency: IdempotencyStore;
  reconcilePlansNow: (params?: { planId?: string; limit?: number }) => Promise<void>;
};

export type IdempotentReply = FastifyReply;
