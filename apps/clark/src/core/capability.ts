import type { z } from 'zod';

export interface CapabilityDescriptor {
  name: string;
  description: string;
  requiresApproval: boolean;
}

export interface CapabilityContext {
  signal: AbortSignal;
}

export interface Capability<TInput = unknown, TOutput = unknown> {
  descriptor: CapabilityDescriptor;
  inputSchema: z.ZodType<TInput>;
  execute(input: TInput, context: CapabilityContext): Promise<TOutput>;
}
