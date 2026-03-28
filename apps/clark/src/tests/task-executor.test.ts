import pino from 'pino';

import { CapabilityRegistry } from '../core/capability-registry.js';
import { TaskExecutor } from '../core/task-executor.js';
import { createSystemInfoCapability } from '../capabilities/system-info.js';

describe('task executor', () => {
  it('executes known capabilities', async () => {
    const registry = new CapabilityRegistry();
    registry.register(createSystemInfoCapability());

    const executor = new TaskExecutor(registry, pino({ enabled: false }), 5000);
    const result = await executor.execute({
      id: 'task-1',
      capability: 'system.info',
      input: {},
    });

    expect(result.success).toBe(true);
    expect(result.capability).toBe('system.info');
  });

  it('returns an error for unknown capabilities', async () => {
    const registry = new CapabilityRegistry();
    const executor = new TaskExecutor(registry, pino({ enabled: false }), 5000);

    const result = await executor.execute({
      id: 'task-1',
      capability: 'missing.capability',
      input: {},
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('unknown_capability');
  });
});
