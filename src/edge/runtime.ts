import { randomUUID } from "node:crypto";
import { createTaskRequestMessage, type EdgeClientTaskResult } from "./protocol.js";

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

type EdgeConnectionHandle = {
  send: (payload: string) => void;
};

type PendingEdgeTask = {
  connectionId: string;
  capability: string;
  resolve: (result: EdgeClientTaskResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export type EdgeCapabilitySummary = {
  clientId: string;
  clientName: string;
  connectionId: string;
  name: string;
  description: string;
  requiresApproval: boolean;
  providerNames: string[];
  lastHeartbeatAt: string | null;
};

export type EdgeCallResult = {
  ok: boolean;
  taskId: string;
  connectionId?: string;
  clientId?: string;
  capability: string;
  durationMs?: number;
  output?: unknown;
  error?: string;
  errorCode?: string;
};

export class EdgeRuntime {
  private readonly clients = new Map<string, EdgeClientRecord>();
  private readonly connections = new Map<string, EdgeConnectionHandle>();
  private readonly pendingTasks = new Map<string, PendingEdgeTask>();

  registerClient(client: EdgeClientInfo, connection: EdgeConnectionHandle): EdgeClientRecord {
    const connectionId = randomUUID();
    const record: EdgeClientRecord = {
      connectionId,
      connectedAt: new Date().toISOString(),
      lastHeartbeatAt: null,
      client,
    };
    this.clients.set(connectionId, record);
    this.connections.set(connectionId, connection);
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
    this.connections.delete(connectionId);
    for (const [taskId, task] of this.pendingTasks.entries()) {
      if (task.connectionId !== connectionId) {
        continue;
      }
      clearTimeout(task.timeout);
      task.reject(new Error(`edge client disconnected before task result: ${task.capability}`));
      this.pendingTasks.delete(taskId);
    }
    return existing;
  }

  listClients(): EdgeClientRecord[] {
    return Array.from(this.clients.values());
  }

  listCapabilities(): EdgeCapabilitySummary[] {
    const out: EdgeCapabilitySummary[] = [];
    for (const record of this.clients.values()) {
      for (const capability of record.client.capabilities) {
        out.push({
          clientId: record.client.clientId,
          clientName: record.client.clientName,
          connectionId: record.connectionId,
          name: capability.name,
          description: capability.description,
          requiresApproval: capability.requiresApproval,
          providerNames: record.client.providers.map((item) => item.name),
          lastHeartbeatAt: record.lastHeartbeatAt,
        });
      }
    }
    return out;
  }

  async dispatchTask(params: {
    capability: string;
    input: unknown;
    clientId?: string;
    timeoutMs?: number;
  }): Promise<EdgeCallResult> {
    const target = this.resolveTarget(params.capability, params.clientId);
    if (!target) {
      return {
        ok: false,
        taskId: randomUUID(),
        clientId: params.clientId,
        capability: params.capability,
        error: params.clientId
          ? `edge client not available: ${params.clientId}`
          : `no connected edge client exposes capability: ${params.capability}`,
        errorCode: "edge_client_unavailable",
      };
    }

    const connection = this.connections.get(target.connectionId);
    if (!connection) {
      return {
        ok: false,
        taskId: randomUUID(),
        connectionId: target.connectionId,
        clientId: target.client.clientId,
        capability: params.capability,
        error: `edge connection not ready: ${target.connectionId}`,
        errorCode: "edge_connection_not_ready",
      };
    }

    const taskId = randomUUID();
    const timeoutMs = Math.max(1, Math.floor(params.timeoutMs ?? 30_000));

    return new Promise<EdgeCallResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingTasks.delete(taskId);
        resolve({
          ok: false,
          taskId,
          connectionId: target.connectionId,
          clientId: target.client.clientId,
          capability: params.capability,
          error: `edge task timed out after ${timeoutMs}ms`,
          errorCode: "edge_task_timeout",
        });
      }, timeoutMs);

      this.pendingTasks.set(taskId, {
        connectionId: target.connectionId,
        capability: params.capability,
        timeout,
        resolve: (result) => {
          clearTimeout(timeout);
          resolve({
            ok: result.success,
            taskId,
            connectionId: target.connectionId,
            clientId: target.client.clientId,
            capability: result.capability,
            durationMs: result.durationMs,
            output: result.output,
            error: result.error?.message,
            errorCode: result.error?.code,
          });
        },
        reject: (error) => {
          clearTimeout(timeout);
          resolve({
            ok: false,
            taskId,
            connectionId: target.connectionId,
            clientId: target.client.clientId,
            capability: params.capability,
            error: error.message,
            errorCode: "edge_task_failed_before_result",
          });
        },
      });

      connection.send(
        JSON.stringify(
          createTaskRequestMessage({
            id: taskId,
            capability: params.capability,
            input: params.input,
            timeoutMs,
          }),
        ),
      );
    });
  }

  resolveTaskResult(connectionId: string, result: EdgeClientTaskResult): boolean {
    const pending = this.pendingTasks.get(result.taskId);
    if (!pending || pending.connectionId !== connectionId) {
      return false;
    }
    this.pendingTasks.delete(result.taskId);
    pending.resolve(result);
    return true;
  }

  private resolveTarget(capability: string, clientId?: string): EdgeClientRecord | null {
    const clients = Array.from(this.clients.values());
    if (clientId) {
      return (
        clients.find(
          (record) =>
            record.client.clientId === clientId &&
            record.client.capabilities.some((item) => item.name === capability),
        ) ?? null
      );
    }
    return clients.find((record) => record.client.capabilities.some((item) => item.name === capability)) ?? null;
  }
}
