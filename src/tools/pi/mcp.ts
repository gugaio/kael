import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ToolLoopGuard } from "../../agents/tool-loop-guard.js";
import type { McpRuntime } from "../mcp/mcp-bridge-service.js";

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

export function createMcpPiTools(params: {
  sessionKey: string;
  mcp: McpRuntime;
  loopGuard?: ToolLoopGuard;
  textResult: (text: string) => TextBlock[];
  makeBlockedResult: (params: {
    reason: string;
    retryAfterMs?: number;
    nextAction?: string;
  }) => { content: TextBlock[]; details: unknown };
  reserveMcpCall: () => { blocked: { content: TextBlock[]; details: unknown } } | null;
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
    name: "mcp_list",
    label: "MCP List",
    description:
      "Lista servidores MCP configurados ou as tools/schema de um servidor especifico via bridge mcporter.",
    parameters: {
      type: "object",
      properties: {
        server: { type: "string", description: "Nome do servidor MCP configurado" },
        schema: { type: "boolean", description: "Quando true, inclui schema das tools do servidor" },
        timeoutMs: { type: "number", description: "Timeout da chamada em milissegundos" },
      },
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveMcpCall();
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as { server?: string; schema?: boolean; timeoutMs?: number };
      const intent = params.logToolStart("mcp_list", args);
      const decision = params.loopGuard?.beforeCall({
        sessionKey: params.sessionKey,
        tool: "mcp_list",
        params: args,
      });
      if (decision && !decision.allowed) {
        const blockedResult = params.makeBlockedResult({
          reason: decision.reason,
          retryAfterMs: decision.retryAfterMs,
        });
        params.logToolEnd("mcp_list", intent, blockedResult.details, startedAtMs);
        return blockedResult;
      }
      const result = await params.mcp.list({
        sessionKey: params.sessionKey,
        server: args.server,
        schema: args.schema,
        timeoutMs: args.timeoutMs,
      });
      params.loopGuard?.afterCall({
        sessionKey: params.sessionKey,
        tool: "mcp_list",
        params: args,
        result,
      });
      const text = [
        `ok=${result.ok}`,
        result.server ? `server=${result.server}` : "",
        `schema=${result.schema}`,
        result.error ? `error=${result.error}` : "",
        result.items !== undefined ? `items:\n${stringifyCompact(result.items)}` : "",
        result.output && result.items === undefined ? `output:\n${result.output}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const response = { content: params.textResult(text), details: result };
      params.logToolEnd(
        "mcp_list",
        intent,
        { status: result.ok ? "completed" : "failed", ...result },
        startedAtMs,
        result.ok ? "mcp_list ok" : `mcp_list failed: ${result.error ?? "unknown"}`,
      );
      return response;
    },
  };

  const callTool: AgentTool = {
    name: "mcp_call",
    label: "MCP Call",
    description:
      "Executa uma tool MCP via bridge mcporter. Use target como server.tool ou URL MCP quando explicitamente permitido.",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "Seletor da tool MCP (ex.: linear.list_issues)" },
        argumentsJson: {
          type: "string",
          description: "Payload JSON serializado para --args, ex.: {\"limit\":5}",
        },
        stdioCommand: {
          type: "string",
          description: "Comando stdio do servidor MCP quando explicitamente permitido",
        },
        timeoutMs: { type: "number", description: "Timeout da chamada em milissegundos" },
      },
      required: ["target"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveMcpCall();
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        target: string;
        argumentsJson?: string;
        stdioCommand?: string;
        timeoutMs?: number;
      };
      const intent = params.logToolStart("mcp_call", args);
      const decision = params.loopGuard?.beforeCall({
        sessionKey: params.sessionKey,
        tool: "mcp_call",
        params: args,
      });
      if (decision && !decision.allowed) {
        const blockedResult = params.makeBlockedResult({
          reason: decision.reason,
          retryAfterMs: decision.retryAfterMs,
        });
        params.logToolEnd("mcp_call", intent, blockedResult.details, startedAtMs);
        return blockedResult;
      }
      const result = await params.mcp.call({
        sessionKey: params.sessionKey,
        target: args.target,
        argumentsJson: args.argumentsJson,
        stdioCommand: args.stdioCommand,
        timeoutMs: args.timeoutMs,
      });
      params.loopGuard?.afterCall({
        sessionKey: params.sessionKey,
        tool: "mcp_call",
        params: args,
        result,
      });
      const text = [
        `ok=${result.ok}`,
        `target=${result.target}`,
        result.error ? `error=${result.error}` : "",
        result.output !== undefined ? `output:\n${stringifyCompact(result.output)}` : "",
        result.rawOutput && result.output === undefined ? `rawOutput:\n${result.rawOutput}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const response = { content: params.textResult(text), details: result };
      params.logToolEnd(
        "mcp_call",
        intent,
        { status: result.ok ? "completed" : "failed", ...result },
        startedAtMs,
        result.ok ? `mcp_call ${result.target}` : `mcp_call failed: ${result.error ?? "unknown"}`,
      );
      return response;
    },
  };

  return [listTool, callTool];
}
