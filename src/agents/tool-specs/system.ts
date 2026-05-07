import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ToolLoopGuard } from "../tool-loop-guard.js";
import type { EngineToolingInterface } from "../types.js";

type TextBlock = {
  type: "text";
  text: string;
};

export function createSystemPiTools(params: {
  sessionKey: string;
  tooling: EngineToolingInterface["system"];
  loopGuard?: ToolLoopGuard;
  textResult: (text: string) => TextBlock[];
  formatSession: (session: {
    id: string;
    status: string;
    command: string;
    outputTail?: string;
    approvalId?: string;
  }) => string;
  makeBlockedResult: (params: {
    reason: string;
    retryAfterMs?: number;
    nextAction?: string;
  }) => { content: TextBlock[]; details: unknown };
  reserveExecCall: () => { blocked: { content: TextBlock[]; details: unknown } } | null;
  reserveProcessCall: () => { blocked: { content: TextBlock[]; details: unknown } } | null;
  logToolStart: (tool: string, rawParams: unknown) => string;
  logToolEnd: (
    tool: string,
    intent: string,
    result: unknown,
    startedAtMs: number,
    summary?: string,
  ) => void;
}): AgentTool[] {
  const execTool: AgentTool = {
    name: "exec",
    label: "Exec",
    description:
      "Executa comando shell local. Suporta background, timeout, policy de seguranca e aprovacao. Para encerrar sessoes iniciadas por exec, prefira a tool process com action=kill.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Comando shell a executar" },
        cwd: { type: "string", description: "Diretorio relativo ao workspace" },
        timeoutMs: { type: "number", description: "Timeout em milissegundos" },
        background: { type: "boolean", description: "Executa em background" },
        security: {
          type: "string",
          enum: ["deny", "allowlist", "full"],
          description: "Override temporario de politica de seguranca",
        },
        ask: {
          type: "string",
          enum: ["off", "on-miss", "always"],
          description: "Override temporario de politica de aprovacao",
        },
      },
      required: ["command"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveExecCall();
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        command: string;
        cwd?: string;
        timeoutMs?: number;
        background?: boolean;
        security?: "deny" | "allowlist" | "full";
        ask?: "off" | "on-miss" | "always";
      };
      const intent = params.logToolStart("exec", args);
      const decision = params.loopGuard?.beforeCall({
        sessionKey: params.sessionKey,
        tool: "exec",
        params: args,
      });
      if (decision && !decision.allowed) {
        const blockedResult = params.makeBlockedResult({
          reason: decision.reason,
          retryAfterMs: decision.retryAfterMs,
        });
        params.logToolEnd("exec", intent, blockedResult.details, startedAtMs);
        return blockedResult;
      }

      const session = await params.tooling.execCommand({
        sessionKey: params.sessionKey,
        command: args.command,
        cwd: args.cwd,
        timeoutMs: args.timeoutMs,
        background: args.background,
        security: args.security,
        ask: args.ask,
      });
      params.loopGuard?.afterCall({
        sessionKey: params.sessionKey,
        tool: "exec",
        params: args,
        result: session,
      });

      const result = {
        content: params.textResult(params.formatSession(session)),
        details: session,
      };
      params.logToolEnd("exec", intent, session, startedAtMs);
      return result;
    },
  };

  const processTool: AgentTool = {
    name: "process",
    label: "Process",
    description:
      "Gerencia sessoes de execucao shell. Acoes: list, poll, log, kill e remove.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "poll", "log", "kill", "remove"],
          description: "Acao da sessao",
        },
        sessionId: {
          type: "string",
          description: "ID da sessao para poll/log/kill/remove",
        },
        offset: { type: "number", description: "Offset de leitura para action=log" },
        limit: { type: "number", description: "Limite de caracteres para action=log" },
      },
      required: ["action"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveProcessCall();
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        action: "list" | "poll" | "log" | "kill" | "remove";
        sessionId?: string;
        offset?: number;
        limit?: number;
      };
      const intent = params.logToolStart("process", args);
      const decision = params.loopGuard?.beforeCall({
        sessionKey: params.sessionKey,
        tool: "process",
        params: args,
      });
      if (decision && !decision.allowed) {
        const blockedResult = params.makeBlockedResult({
          reason: decision.reason,
          retryAfterMs: decision.retryAfterMs,
        });
        params.logToolEnd("process", intent, blockedResult.details, startedAtMs);
        return blockedResult;
      }
      const result = await params.tooling.processCommand({
        sessionKey: params.sessionKey,
        action: args.action,
        sessionId: args.sessionId,
        offset: args.offset,
        limit: args.limit,
      });
      params.loopGuard?.afterCall({
        sessionKey: params.sessionKey,
        tool: "process",
        params: args,
        result,
      });

      const text =
        args.action === "list"
          ? `ok=${result.ok}\nsessions=${(result.sessions ?? []).length}`
          : args.action === "log"
            ? [
                `ok=${result.ok}`,
                result.message ? `message=${result.message}` : "",
                result.output ? `output:\n${result.output}` : "",
              ]
                .filter(Boolean)
                .join("\n")
          : [
              `ok=${result.ok}`,
              result.message ? `message=${result.message}` : "",
              result.session ? params.formatSession(result.session) : "",
            ]
              .filter(Boolean)
              .join("\n");

      const toolResult = {
        content: params.textResult(text),
        details: result,
      };
      params.logToolEnd("process", intent, result, startedAtMs);
      return toolResult;
    },
  };

  return [execTool, processTool];
}
