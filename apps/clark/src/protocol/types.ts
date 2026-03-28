import type { CapabilityDescriptor } from '../core/capability.js';
import type { McpProviderInfo } from '../mcp/types.js';
import type { SerializedError } from '../utils/errors.js';

export interface ClientInfo {
  clientId: string;
  clientName: string;
  hostname: string;
  machineName: string;
  platform: string;
  arch: string;
  version: string;
  capabilities: CapabilityDescriptor[];
  providers: McpProviderInfo[];
  startedAt: string;
}

export interface TaskRequest {
  id: string;
  capability: string;
  input: unknown;
  timeoutMs?: number;
}

export interface TaskResult {
  taskId: string;
  capability: string;
  success: boolean;
  output?: unknown;
  error?: SerializedError;
  durationMs: number;
}

export interface Envelope<TType extends string, TPayload> {
  version: 1;
  type: TType;
  timestamp: string;
  payload: TPayload;
}

export type ClientRegisterMessage = Envelope<'client.register', { client: ClientInfo }>;
export type ClientHeartbeatMessage = Envelope<'client.heartbeat', { clientId: string }>;
export type ClientTaskResultMessage = Envelope<'client.task.result', { result: TaskResult }>;

export type ClientMessage =
  | ClientRegisterMessage
  | ClientHeartbeatMessage
  | ClientTaskResultMessage;

export type ServerRegisteredMessage = Envelope<'server.registered', { connectionId: string }>;
export type ServerTaskRequestMessage = Envelope<'server.task.request', { task: TaskRequest }>;

export type ServerMessage =
  | ServerRegisteredMessage
  | ServerTaskRequestMessage;
