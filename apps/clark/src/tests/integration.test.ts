import { once } from 'node:events';

import pino from 'pino';
import WebSocket, { WebSocketServer, type RawData } from 'ws';

import { EdgeClient } from '../core/edge-client.js';
import type { ClarkSettings } from '../config/settings.js';

describe('edge client integration', () => {
  it('registers, receives a task and returns a result', async () => {
    const server = new WebSocketServer({ port: 0 });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP address');
    }

    const messages: unknown[] = [];
    let taskResultReceived = false;

    server.on('connection', (socket: InstanceType<typeof WebSocket>) => {
      socket.on('message', (raw: RawData) => {
        const parsed = JSON.parse(String(raw)) as { type: string; payload: unknown };
        messages.push(parsed);

        if (parsed.type === 'client.register') {
          socket.send(JSON.stringify({
            version: 1,
            type: 'server.registered',
            timestamp: new Date().toISOString(),
            payload: { connectionId: 'conn-1' },
          }));

          socket.send(JSON.stringify({
            version: 1,
            type: 'server.task.request',
            timestamp: new Date().toISOString(),
            payload: {
              task: {
                id: 'task-1',
                capability: 'system.info',
                input: {},
              },
            },
          }));
        }

        if (parsed.type === 'client.task.result') {
          taskResultReceived = true;
          socket.close();
        }
      });
    });

    const settings: ClarkSettings = {
      configPath: '/tmp/clark.config.json',
      serverUrl: `ws://127.0.0.1:${address.port}`,
      clientId: 'test-client',
      clientName: 'Test Client',
      heartbeatIntervalMs: 1000,
      reconnectBaseDelayMs: 25,
      reconnectMaxDelayMs: 50,
      taskTimeoutMs: 5000,
      httpAllowlist: ['127.0.0.1', 'localhost'],
      httpTimeoutMs: 2000,
      httpMaxBytes: 4096,
      mcpBridgeBinary: 'mcporter',
      mcpBridgeConfigPath: undefined,
      mcpBridgeMaxOutputChars: 120000,
      httpProfiles: [],
      mcpHttpServers: [],
      mcpCapabilityBindings: [],
      logLevel: 'error',
    };

    const client = await EdgeClient.create(settings, pino({ enabled: false }));
    const runPromise = client.run();

    await vi.waitFor(() => {
      expect(taskResultReceived).toBe(true);
    });

    await client.stop();
    await expect(runPromise).resolves.toBeUndefined();

    server.close();

    expect(messages.some((message) => (message as { type: string }).type === 'client.register')).toBe(true);
    expect(messages.some((message) => (message as { type: string }).type === 'client.task.result')).toBe(true);
    const registerMessage = messages.find((message) => (message as { type: string }).type === 'client.register') as {
      payload: {
        client: {
          providers: unknown[];
        };
      };
    };
    expect(Array.isArray(registerMessage.payload.client.providers)).toBe(true);
  });
});
