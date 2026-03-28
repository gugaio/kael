import type {
  ClientInfo,
  ClientMessage,
  ClientRegisterMessage,
  ClientHeartbeatMessage,
  ClientTaskResultMessage,
  TaskResult,
} from './types.js';
import { serverMessageSchema } from './schemas.js';
import { nowIso } from '../utils/time.js';

export function createRegisterMessage(client: ClientInfo): ClientRegisterMessage {
  return {
    version: 1,
    type: 'client.register',
    timestamp: nowIso(),
    payload: { client },
  };
}

export function createHeartbeatMessage(clientId: string): ClientHeartbeatMessage {
  return {
    version: 1,
    type: 'client.heartbeat',
    timestamp: nowIso(),
    payload: { clientId },
  };
}

export function createTaskResultMessage(result: TaskResult): ClientTaskResultMessage {
  return {
    version: 1,
    type: 'client.task.result',
    timestamp: nowIso(),
    payload: { result },
  };
}

export function serializeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}

export function parseServerMessage(raw: string) {
  return serverMessageSchema.parse(JSON.parse(raw));
}
