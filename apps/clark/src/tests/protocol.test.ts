import { parseServerMessage } from '../protocol/messages.js';

describe('protocol', () => {
  it('parses server.task.request messages', () => {
    const parsed = parseServerMessage(JSON.stringify({
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

    expect(parsed.type).toBe('server.task.request');
    if (parsed.type !== 'server.task.request') {
      throw new Error('Expected server.task.request');
    }
    expect(parsed.payload.task.id).toBe('task-1');
  });
});
