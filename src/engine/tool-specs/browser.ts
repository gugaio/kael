import type { AgentTool } from "@mariozechner/pi-agent-core";
import {
  BROWSER_ACTION_VALUES,
  type BrowserCommandAction,
  formatBrowserToolText,
  isBrowserInteractionAction,
} from "../../capabilities/browser/index.js";
import type { EngineTooling } from "../types.js";

type TextBlock = {
  type: "text";
  text: string;
};

export function createBrowserPiTool(params: {
  sessionKey: string;
  tooling: EngineTooling;
  textResult: (text: string) => TextBlock[];
  reserveBrowserCall: (actionRaw: string) => { blocked: { content: TextBlock[]; details: unknown } } | null;
  logToolStart: (tool: string, rawParams: unknown) => string;
  logToolEnd: (
    tool: string,
    intent: string,
    result: unknown,
    startedAtMs: number,
    summary?: string,
  ) => void;
}): AgentTool {
  return {
    name: "browser",
    label: "Browser",
    description:
      "Controla runtime de browser do Kael. Nesta fase inicial o runtime responde estado de disponibilidade e readiness de implementacao.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: BROWSER_ACTION_VALUES,
        },
        targetId: { type: "string" },
        url: { type: "string" },
        selector: { type: "string" },
        text: { type: "string" },
        key: { type: "string" },
        timeoutMs: { type: "number" },
      },
      required: ["action"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const actionRaw =
        rawParams && typeof rawParams === "object"
          ? String((rawParams as { action?: unknown }).action ?? "")
          : "";
      const blocked = params.reserveBrowserCall(actionRaw);
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        action: BrowserCommandAction;
        targetId?: string;
        url?: string;
        selector?: string;
        text?: string;
        key?: string;
        timeoutMs?: number;
      };
      const intent = params.logToolStart("browser", args);
      const result = await params.tooling.browserCommand({
        sessionKey: params.sessionKey,
        action: args.action,
        targetId: args.targetId,
        url: args.url,
        selector: args.selector,
        text: args.text,
        key: args.key,
        timeoutMs: args.timeoutMs,
      });
      params.logToolEnd(
        "browser",
        intent,
        result,
        startedAtMs,
        `browser action=${result.action} status=${result.status}`,
      );
      return {
        content: params.textResult(formatBrowserToolText(result)),
        details: result,
      };
    },
  };
}

export function isInteractionActionRaw(actionRaw: string): boolean {
  return isBrowserInteractionAction(actionRaw);
}
