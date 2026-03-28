import { CapabilityRegistry } from '../core/capability-registry.js';
import { createSystemInfoCapability } from '../capabilities/system-info.js';

describe('capability registry', () => {
  it('registers and lists capabilities', () => {
    const registry = new CapabilityRegistry();
    registry.register(createSystemInfoCapability());

    expect(registry.get('system.info')).toBeDefined();
    expect(registry.list()).toHaveLength(1);
  });
});
