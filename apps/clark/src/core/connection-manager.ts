import WebSocket, { type RawData } from 'ws';
import type { Logger } from 'pino';

import type { ClientInfo, ServerMessage } from '../protocol/types.js';
import { calculateBackoffDelay } from './backoff.js';
import {
  createHeartbeatMessage,
  createRegisterMessage,
  createTaskResultMessage,
  parseServerMessage,
  serializeClientMessage,
} from '../protocol/messages.js';
import type { TaskExecutor } from './task-executor.js';
import { sleep } from '../utils/time.js';

export interface ConnectionManagerOptions {
  serverUrl: string;
  clientId: string;
  clientInfo: ClientInfo;
  heartbeatIntervalMs: number;
  reconnectBaseDelayMs: number;
  reconnectMaxDelayMs: number;
}

export class ConnectionManager {
  private shouldRun = true;
  private socket: WebSocket | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly options: ConnectionManagerOptions,
    private readonly taskExecutor: TaskExecutor,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    let attempt = 0;

    while (this.shouldRun) {
      try {
        await this.connectOnce();
        attempt = 0;
      } catch (error) {
        if (!this.shouldRun) {
          break;
        }

        const delayMs = calculateBackoffDelay(
          attempt,
          this.options.reconnectBaseDelayMs,
          this.options.reconnectMaxDelayMs,
        );

        this.logger.warn({
          event: 'connection.retry',
          attempt,
          delayMs,
          error,
        }, 'Connection lost, retrying');

        attempt += 1;
        await sleep(delayMs);
      }
    }
  }

  async stop(): Promise<void> {
    this.shouldRun = false;
    this.clearHeartbeat();
    const socket = this.socket;
    this.socket = undefined;

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  }

  private async connectOnce(): Promise<void> {
    const socket = await this.openSocket();
    this.socket = socket;

    this.logger.info({
      event: 'connection.opened',
      serverUrl: this.options.serverUrl,
    }, 'Connected to server');

    socket.send(serializeClientMessage(createRegisterMessage(this.options.clientInfo)));
    this.startHeartbeat();

    await new Promise<void>((resolve, reject) => {
      socket.on('message', (data: RawData, isBinary: boolean) => {
        if (isBinary) {
          return;
        }

        void this.handleIncoming(String(data)).catch((error) => {
          this.logger.error({ event: 'protocol.error', error }, 'Failed to handle server message');
        });
      });

      socket.once('close', () => {
        this.clearHeartbeat();
        this.socket = undefined;
        if (this.shouldRun) {
          reject(new Error('Socket closed'));
          return;
        }

        resolve();
      });

      socket.once('error', (error: Error) => {
        this.clearHeartbeat();
        this.socket = undefined;
        reject(error);
      });
    });
  }

  private openSocket(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.options.serverUrl);
      socket.once('open', () => resolve(socket));
      socket.once('error', (error: Error) => reject(error));
    });
  }

  private async handleIncoming(raw: string): Promise<void> {
    const message = parseServerMessage(raw);

    switch (message.type) {
      case 'server.registered':
        this.logger.info({
          event: 'register.accepted',
          connectionId: message.payload.connectionId,
        }, 'Server accepted client registration');
        return;
      case 'server.task.request':
        await this.handleTaskRequest(message);
        return;
      default:
        this.assertNever(message);
    }
  }

  private async handleTaskRequest(message: Extract<ServerMessage, { type: 'server.task.request' }>): Promise<void> {
    this.logger.info({
      event: 'task.received',
      taskId: message.payload.task.id,
      capability: message.payload.task.capability,
    }, 'Received task from server');

    const result = await this.taskExecutor.execute(message.payload.task);
    this.send(createTaskResultMessage(result));
  }

  private send(message: ReturnType<typeof createHeartbeatMessage> | ReturnType<typeof createTaskResultMessage>): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.logger.warn({ event: 'connection.not_ready' }, 'Dropping message because socket is not open');
      return;
    }

    socket.send(serializeClientMessage(message));
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send(createHeartbeatMessage(this.options.clientId));
      this.logger.debug({ event: 'heartbeat.sent' }, 'Heartbeat sent');
    }, this.options.heartbeatIntervalMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private assertNever(_value: never): never {
    throw new Error('Unexpected message variant');
  }
}
