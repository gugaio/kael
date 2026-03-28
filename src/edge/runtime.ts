import { randomUUID } from "node:crypto";

export type EdgeCapabilityDescriptor = {
  name: string;
  description: string;
  requiresApproval: boolean;
};

export type EdgeProviderInfo = {
  name: string;
  kind: "mcp-http";
  status: "available" | "unreachable";
  capabilities: string[];
};

export type EdgeClientInfo = {
  clientId: string;
  clientName: string;
  hostname: string;
  machineName: string;
  platform: string;
  arch: string;
  version: string;
  capabilities: EdgeCapabilityDescriptor[];
  providers: EdgeProviderInfo[];
  startedAt: string;
};

export type EdgeClientRecord = {
  connectionId: string;
  connectedAt: string;
  lastHeartbeatAt: string | null;
  client: EdgeClientInfo;
};

export class EdgeRuntime {
  private readonly clients = new Map<string, EdgeClientRecord>();

  registerClient(client: EdgeClientInfo): EdgeClientRecord {
    const connectionId = randomUUID();
    const record: EdgeClientRecord = {
      connectionId,
      connectedAt: new Date().toISOString(),
      lastHeartbeatAt: null,
      client,
    };
    this.clients.set(connectionId, record);
    return record;
  }

  markHeartbeat(connectionId: string): EdgeClientRecord | null {
    const existing = this.clients.get(connectionId);
    if (!existing) {
      return null;
    }
    const updated: EdgeClientRecord = {
      ...existing,
      lastHeartbeatAt: new Date().toISOString(),
    };
    this.clients.set(connectionId, updated);
    return updated;
  }

  removeClient(connectionId: string): EdgeClientRecord | null {
    const existing = this.clients.get(connectionId) ?? null;
    this.clients.delete(connectionId);
    return existing;
  }

  listClients(): EdgeClientRecord[] {
    return Array.from(this.clients.values());
  }
}
