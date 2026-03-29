import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { EngineTooling } from "../types.js";

type TextBlock = {
  type: "text";
  text: string;
};

function stringifyCompact(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function createEdgePiTools(params: {
  tooling: EngineTooling;
  textResult: (text: string) => TextBlock[];
  makeBlockedResult: (params: {
    reason: string;
    retryAfterMs?: number;
    nextAction?: string;
  }) => { content: TextBlock[]; details: unknown };
  reserveEdgeCall: () => { blocked: { content: TextBlock[]; details: unknown } } | null;
  logToolStart: (tool: string, rawParams: unknown) => string;
  logToolEnd: (
    tool: string,
    intent: string,
    result: unknown,
    startedAtMs: number,
    summary?: string,
  ) => void;
}): AgentTool[] {
  const listTool: AgentTool = {
    name: "edge_list",
    label: "Edge List",
    description: "Lista clients e capabilities remotas disponiveis via Clark conectado.",
    parameters: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Filtra por clientId do Clark" },
        capability: { type: "string", description: "Filtra por nome exato da capability" },
      },
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as { clientId?: string; capability?: string };
      const intent = params.logToolStart("edge_list", args);
      const items = params.tooling.edgeList({ clientId: args.clientId, capability: args.capability });
      const text = [`ok=true`, `count=${items.length}`, items.length > 0 ? `items:\n${stringifyCompact(items)}` : ""]
        .filter(Boolean)
        .join("\n");
      const response = { content: params.textResult(text), details: { ok: true, count: items.length, items } };
      params.logToolEnd(
        "edge_list",
        intent,
        { status: "completed", ok: true, count: items.length },
        startedAtMs,
        "edge_list ok",
      );
      return response;
    },
  };

  const callTool: AgentTool = {
    name: "edge_call",
    label: "Edge Call",
    description: "Executa uma capability remota exposta por um Clark conectado.",
    parameters: {
      type: "object",
      properties: {
        capability: { type: "string", description: "Nome da capability remota (ex.: system.info)" },
        inputJson: { type: "string", description: "Payload JSON serializado para a capability" },
        clientId: { type: "string", description: "Forca um clientId especifico quando houver mais de um Clark" },
        timeoutMs: { type: "number", description: "Timeout total da task remota em milissegundos" },
      },
      required: ["capability"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveEdgeCall();
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        capability: string;
        inputJson?: string;
        clientId?: string;
        timeoutMs?: number;
      };
      const intent = params.logToolStart("edge_call", args);
      let input: unknown = {};
      if (args.inputJson?.trim()) {
        try {
          input = JSON.parse(args.inputJson);
        } catch (error) {
          const blockedResult = params.makeBlockedResult({
            reason: `invalid_edge_input_json:${error instanceof Error ? error.message : String(error)}`,
          });
          params.logToolEnd("edge_call", intent, blockedResult.details, startedAtMs);
          return blockedResult;
        }
      }
      const result = await params.tooling.edgeCall({
        capability: args.capability,
        input,
        clientId: args.clientId,
        timeoutMs: args.timeoutMs,
      });
      const text = [
        `ok=${result.ok}`,
        `taskId=${result.taskId}`,
        `capability=${result.capability}`,
        result.clientId ? `clientId=${result.clientId}` : "",
        result.connectionId ? `connectionId=${result.connectionId}` : "",
        typeof result.durationMs === "number" ? `durationMs=${result.durationMs}` : "",
        result.errorCode ? `errorCode=${result.errorCode}` : "",
        result.error ? `error=${result.error}` : "",
        result.output !== undefined ? `output:\n${stringifyCompact(result.output)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const response = { content: params.textResult(text), details: result };
      params.logToolEnd(
        "edge_call",
        intent,
        { status: result.ok ? "completed" : "failed", ...result },
        startedAtMs,
        result.ok ? `edge_call ${result.capability}` : `edge_call failed: ${result.error ?? "unknown"}`,
      );
      return response;
    },
  };

  return [listTool, callTool];
}
