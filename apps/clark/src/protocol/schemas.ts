import { z } from 'zod';

const capabilityDescriptorSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  requiresApproval: z.boolean(),
});

const providerInfoSchema = z.object({
  name: z.string().min(1),
  kind: z.literal('mcp-http'),
  status: z.enum(['available', 'unreachable']),
  capabilities: z.array(z.string().min(1)),
});

export const clientInfoSchema = z.object({
  clientId: z.string().min(1),
  clientName: z.string().min(1),
  hostname: z.string().min(1),
  machineName: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  version: z.string().min(1),
  capabilities: z.array(capabilityDescriptorSchema),
  providers: z.array(providerInfoSchema),
  startedAt: z.string().datetime(),
});

export const taskRequestSchema = z.object({
  id: z.string().min(1),
  capability: z.string().min(1),
  input: z.unknown(),
  timeoutMs: z.number().int().positive().optional(),
});

export const taskResultSchema = z.object({
  taskId: z.string().min(1),
  capability: z.string().min(1),
  success: z.boolean(),
  output: z.unknown().optional(),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }).optional(),
  durationMs: z.number().int().nonnegative(),
});

const envelopeSchema = <TType extends string, TPayload extends z.ZodTypeAny>(type: TType, payload: TPayload) => z.object({
  version: z.literal(1),
  type: z.literal(type),
  timestamp: z.string().datetime(),
  payload,
});

export const clientRegisterSchema = envelopeSchema('client.register', z.object({
  client: clientInfoSchema,
}));

export const clientHeartbeatSchema = envelopeSchema('client.heartbeat', z.object({
  clientId: z.string().min(1),
}));

export const clientTaskResultSchema = envelopeSchema('client.task.result', z.object({
  result: taskResultSchema,
}));

export const serverRegisteredSchema = envelopeSchema('server.registered', z.object({
  connectionId: z.string().min(1),
}));

export const serverTaskRequestSchema = envelopeSchema('server.task.request', z.object({
  task: taskRequestSchema,
}));

export const serverMessageSchema = z.discriminatedUnion('type', [
  serverRegisteredSchema,
  serverTaskRequestSchema,
]);
