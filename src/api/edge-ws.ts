import type { FastifyInstance } from "fastify";
import { WebSocketServer } from "ws";
import type { KaelApp } from "../app.js";
import { createRegisteredMessage, parseEdgeInboundMessage } from "../edge/protocol.js";
import { kaelLogger } from "../infra/logger.js";

type EdgeSocket = {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  once: (event: string, handler: (...args: unknown[]) => void) => void;
  send: (payload: string) => void;
  close: () => void;
};

export function registerEdgeWsGateway(server: FastifyInstance, app: KaelApp): void {
  const edgeWsServer = new WebSocketServer({ noServer: true });

  server.server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/ws") {
      socket.destroy();
      return;
    }

    edgeWsServer.handleUpgrade(request, socket, head, (ws: EdgeSocket) => {
      edgeWsServer.emit("connection", ws, request);
    });
  });

  edgeWsServer.on("connection", (ws: EdgeSocket) => {
    let connectionId: string | null = null;

    ws.on("message", (raw: unknown) => {
      const rawText = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);

      try {
        const message = parseEdgeInboundMessage(rawText);
        if (message.type === "client.register") {
          const record = app.edge.registerClient(message.payload.client, {
            send: (payload: string) => ws.send(payload),
          });
          connectionId = record.connectionId;
          kaelLogger.info("edge.client.registered", {
            connectionId,
            clientId: record.client.clientId,
            clientName: record.client.clientName,
            hostname: record.client.hostname,
            capabilities: record.client.capabilities.map((item) => item.name),
            providers: record.client.providers.map((item) => ({
              name: item.name,
              kind: item.kind,
              status: item.status,
            })),
          });
          ws.send(JSON.stringify(createRegisteredMessage(connectionId)));
          return;
        }

        if (message.type === "client.heartbeat") {
          if (!connectionId) {
            kaelLogger.warn("edge.client.heartbeat.before_register", {
              clientId: message.payload.clientId,
            });
            return;
          }
          const record = app.edge.markHeartbeat(connectionId);
          kaelLogger.info("edge.client.heartbeat", {
            connectionId,
            clientId: message.payload.clientId,
            known: !!record,
          });
          return;
        }

        if (!connectionId) {
          kaelLogger.warn("edge.client.task_result.before_register", {
            taskId: message.payload.result.taskId,
          });
          return;
        }

        const resolved = app.edge.resolveTaskResult(connectionId, message.payload.result);
        kaelLogger.info("edge.client.task_result", {
          connectionId,
          taskId: message.payload.result.taskId,
          capability: message.payload.result.capability,
          success: message.payload.result.success,
          resolved,
        });
      } catch (error) {
        kaelLogger.warn("edge.client.protocol_error", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });

    ws.once("close", () => {
      if (!connectionId) {
        return;
      }
      const removed = app.edge.removeClient(connectionId);
      kaelLogger.info("edge.client.disconnected", {
        connectionId,
        clientId: removed?.client.clientId ?? null,
      });
    });
  });
}
