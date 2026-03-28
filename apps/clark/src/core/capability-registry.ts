import type { Capability, CapabilityDescriptor } from './capability.js';

export class CapabilityRegistry {
  private readonly items = new Map<string, Capability>();

  register(capability: Capability): void {
    this.items.set(capability.descriptor.name, capability);
  }

  get(name: string): Capability | undefined {
    return this.items.get(name);
  }

  list(): CapabilityDescriptor[] {
    return Array.from(this.items.values()).map((item) => item.descriptor);
  }
}
