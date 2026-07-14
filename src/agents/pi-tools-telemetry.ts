import { kaelLogger } from "../infra/logger.js";
import type { EngineOutputArtifact } from "./types.js";

type TextBlock = {
  type: "text";
  text: string;
};

export type ToolEventSink = (event: {
  phase: "start" | "end";
  tool: string;
  status?: string;
  blocked?: boolean;
  reason?: string;
  summary?: string;
  artifact?: EngineOutputArtifact;
}) => void;

export function textResult(text: string) {
  return [{ type: "text", text } satisfies TextBlock];
}

export function formatSession(session: {
  id: string;
  status: string;
  command: string;
  outputTail?: string;
  approvalId?: string;
}): string {
  const lines = [`session=${session.id}`, `status=${session.status}`, `command=${session.command}`];
  if (session.approvalId) {
    lines.push(`approvalId=${session.approvalId}`);
  }
  if (session.outputTail && session.outputTail.trim()) {
    lines.push(`output:\n${session.outputTail}`);
  }
  return lines.join("\n");
}

export function inferToolIntent(tool: string, rawParams: unknown): string {
  if (tool === "memory_search") return "memory:search";
  if (tool === "memory_get") return "memory:get";
  if (tool === "memory_write") return "memory:write";
  if (tool === "process") {
    const action =
      rawParams && typeof rawParams === "object"
        ? String((rawParams as { action?: unknown }).action ?? "")
        : "";
    return action ? `process:${action}` : "process:unknown";
  }
  if (tool === "video_hls_inspect") return "video:hls_inspect";
  if (tool === "video_probe") return "video:probe";
  if (tool === "video_manifest_audit") return "video:manifest_audit";
  if (tool === "video_manifest_diff") return "video:manifest_diff";
  if (tool === "video_stream_watch") return "video:stream_watch";
  if (tool === "playback_analyze") return "video:playback_analyze";
  if (tool === "web_search") return "web:search";
  if (tool === "web_fetch") return "web:fetch";
  if (tool === "web_research") return "web:research";
  if (tool === "browser") {
    const action =
      rawParams && typeof rawParams === "object"
        ? String((rawParams as { action?: unknown }).action ?? "")
        : "";
    return action ? `browser:${action}` : "browser:unknown";
  }
  if (tool === "mcp_list") return "mcp:list";
  if (tool === "mcp_call") {
    const target =
      rawParams && typeof rawParams === "object"
        ? String((rawParams as { target?: unknown }).target ?? "")
        : "";
    return target ? `mcp:call:${target}` : "mcp:call";
  }
  if (tool === "edge_list") return "edge:list";
  if (tool === "edge_call") {
    const capability =
      rawParams && typeof rawParams === "object"
        ? String((rawParams as { capability?: unknown }).capability ?? "")
        : "";
    return capability ? `edge:call:${capability}` : "edge:call";
  }
  if (tool === "youbora_metrics_get") return "edge:call:youbora.metrics.get";
  if (tool === "youbora_rawdata_get") return "edge:call:youbora.rawdata.get";
  if (tool === "youbora_events_get") return "edge:call:youbora.events.get";
  const command =
    rawParams && typeof rawParams === "object"
      ? String((rawParams as { command?: unknown }).command ?? "").toLowerCase()
      : "";
  if (!command) return "exec:unknown";
  if (command.includes("ffprobe")) return "exec:media_probe";
  if (command.includes("ffmpeg")) return "exec:media_transform";
  if (command.includes("curl") || command.includes("wget")) return "exec:network_fetch";
  if (command.includes("python") || command.includes("node")) return "exec:script_run";
  if (command.includes("ls") || command.includes("cat") || command.includes("find")) return "exec:file_inspect";
  return "exec:generic";
}

export function createToolTelemetry(params: {
  sessionKey: string;
  trace?: {
    turnId: string;
    attempt: number;
    requestId?: string;
    goal?: string;
  };
  onToolEvent?: ToolEventSink;
}) {
  const logToolStart = (tool: string, rawParams: unknown): string => {
    const intent = inferToolIntent(tool, rawParams);
    kaelLogger.info("pi.tool.call.started", {
      turnId: params.trace?.turnId ?? null,
      attempt: params.trace?.attempt ?? null,
      requestId: params.trace?.requestId ?? null,
      sessionKey: params.sessionKey,
      tool,
      intent,
      goal: params.trace?.goal ? params.trace.goal.slice(0, 180) : null,
    });
    params.onToolEvent?.({ phase: "start", tool });
    return intent;
  };

  const logToolEnd = (
    tool: string,
    intent: string,
    result: unknown,
    startedAtMs: number,
    summary?: string,
    artifact?: EngineOutputArtifact,
  ): void => {
    const typed = (result ?? {}) as {
      status?: unknown;
      blocked?: unknown;
      reason?: unknown;
      resultCount?: unknown;
      topPaths?: unknown;
      path?: unknown;
    };
    const status = typeof typed.status === "string" ? typed.status : "unknown";
    const blocked = typed.blocked === true;
    const reason = typeof typed.reason === "string" ? typed.reason : undefined;
    const error = typeof (typed as { error?: unknown }).error === "string"
      ? (typed as { error: string }).error
      : undefined;
    const resultCount = typeof typed.resultCount === "number" ? typed.resultCount : undefined;
    const topPaths = Array.isArray(typed.topPaths)
      ? typed.topPaths.filter((v): v is string => typeof v === "string").slice(0, 5)
      : undefined;
    const path = typeof typed.path === "string" ? typed.path : undefined;
    kaelLogger.info("pi.tool.call.finished", {
      turnId: params.trace?.turnId ?? null,
      attempt: params.trace?.attempt ?? null,
      requestId: params.trace?.requestId ?? null,
      sessionKey: params.sessionKey,
      tool,
      intent,
      status,
      blocked,
      reason,
      error,
      resultCount,
      topPaths,
      path,
      summary: summary ? summary.slice(0, 220) : undefined,
      durationMs: Date.now() - startedAtMs,
    });
    params.onToolEvent?.({ phase: "end", tool, status, blocked, reason, summary, artifact });
  };

  return {
    logToolStart,
    logToolEnd,
  };
}
