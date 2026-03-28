import type { EdgeClientInfo } from "./runtime.js";

export type EdgeClientRegisterMessage = {
  version: 1;
  type: "client.register";
  timestamp: string;
  payload: {
    client: EdgeClientInfo;
  };
};

export type EdgeClientHeartbeatMessage = {
  version: 1;
  type: "client.heartbeat";
  timestamp: string;
  payload: {
    clientId: string;
  };
};

export type EdgeServerRegisteredMessage = {
  version: 1;
  type: "server.registered";
  timestamp: string;
  payload: {
    connectionId: string;
    accepted: true;
  };
};

export type EdgeInboundMessage = EdgeClientRegisterMessage | EdgeClientHeartbeatMessage;

export function parseEdgeInboundMessage(raw: string): EdgeInboundMessage {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("invalid edge message: expected object");
  }

  const version = (parsed as { version?: unknown }).version;
  const type = (parsed as { type?: unknown }).type;
  const timestamp = (parsed as { timestamp?: unknown }).timestamp;
  const payload = (parsed as { payload?: unknown }).payload;

  if (version !== 1 || typeof type !== "string" || typeof timestamp !== "string" || !payload || typeof payload !== "object") {
    throw new Error("invalid edge message envelope");
  }

  if (type === "client.register") {
    const client = (payload as { client?: unknown }).client;
    if (!isEdgeClientInfo(client)) {
      throw new Error("invalid client.register payload");
    }
    return {
      version: 1,
      type,
      timestamp,
      payload: { client },
    };
  }

  if (type === "client.heartbeat") {
    const clientId = (payload as { clientId?: unknown }).clientId;
    if (typeof clientId !== "string" || !clientId.trim()) {
      throw new Error("invalid client.heartbeat payload");
    }
    return {
      version: 1,
      type,
      timestamp,
      payload: { clientId },
    };
  }

  throw new Error(`unsupported edge message type: ${type}`);
}

export function createRegisteredMessage(connectionId: string): EdgeServerRegisteredMessage {
  return {
    version: 1,
    type: "server.registered",
    timestamp: new Date().toISOString(),
    payload: {
      connectionId,
      accepted: true,
    },
  };
}

function isEdgeClientInfo(input: unknown): input is EdgeClientInfo {
  if (!input || typeof input !== "object") {
    return false;
  }
  const value = input as Record<string, unknown>;
  return (
    typeof value.clientId === "string" &&
    typeof value.clientName === "string" &&
    typeof value.hostname === "string" &&
    typeof value.machineName === "string" &&
    typeof value.platform === "string" &&
    typeof value.arch === "string" &&
    typeof value.version === "string" &&
    typeof value.startedAt === "string" &&
    Array.isArray(value.capabilities) &&
    Array.isArray(value.providers)
  );
}
