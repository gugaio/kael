import type { z } from 'zod';

export interface CapabilityParameterDescriptor {
  name: string;
  description: string;
  required: boolean;
}

export interface CapabilityTemplateDescriptor {
  name: string;
  description: string;
  method: 'GET';
  pathTemplate: string;
  params: CapabilityParameterDescriptor[];
}

export interface CapabilityDescriptor {
  name: string;
  description: string;
  requiresApproval: boolean;
  metadata?: {
    httpProfile?: string;
    templates?: CapabilityTemplateDescriptor[];
  };
}

export interface CapabilityContext {
  signal: AbortSignal;
}

export interface Capability<TInput = unknown, TOutput = unknown> {
  descriptor: CapabilityDescriptor;
  inputSchema: z.ZodType<TInput, z.ZodTypeDef, unknown>;
  execute(input: TInput, context: CapabilityContext): Promise<TOutput>;
}
