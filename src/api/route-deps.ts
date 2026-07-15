import type { FastifyReply, FastifyRequest } from "fastify";
import type { KaelApp } from "../app.js";
import type { IdempotencyStore } from "../infra/idempotency-store.js";
import type { ReconcilePlansNowParams } from "./services/plan-reconciler.js";

export type RequestWithStart = FastifyRequest & {
  _kaelStartNs?: bigint;
};

export type ApiRouteDeps = {
  app: KaelApp;
  idempotency: IdempotencyStore;
  reconcilePlansNow: (params?: ReconcilePlansNowParams) => Promise<void>;
};

export type IdempotentReply = FastifyReply;
