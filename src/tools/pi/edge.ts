import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { EngineToolingInterface } from "../../agents/types.js";

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
  tooling: EngineToolingInterface["edge"];
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

  const youboraMetricsGetTool: AgentTool = {
    name: "youbora_metrics_get",
    label: "Youbora Metrics Get",
    description:
      "Consulta metricas agregadas do Youbora via Clark/MCP usando a capability remota youbora.metrics.get.",
    parameters: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Data inicial ou relativo, ex.: last24hours" },
        toDate: { type: "string", description: "Data final quando fromDate nao for relativo" },
        metrics: { type: "string", description: "Lista de metricas, ex.: views,plays,errors" },
        type: { type: "string", description: "Tipo de conteudo, ex.: vod ou live" },
        granularity: { type: "string", description: "Granularidade, ex.: hour/day/week/month" },
        filtersJson: { type: "string", description: "Filtros adicionais em JSON serializado" },
        clientId: { type: "string", description: "ClientId especifico do Clark quando houver mais de um conectado" },
        timeoutMs: { type: "number", description: "Timeout total da task remota em milissegundos" },
      },
      required: ["fromDate"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveEdgeCall();
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        fromDate: string;
        toDate?: string;
        metrics?: string;
        type?: string;
        granularity?: string;
        filtersJson?: string;
        clientId?: string;
        timeoutMs?: number;
      };
      const intent = params.logToolStart("youbora_metrics_get", args);
      let filters: unknown;
      if (args.filtersJson?.trim()) {
        try {
          filters = JSON.parse(args.filtersJson);
        } catch (error) {
          const blockedResult = params.makeBlockedResult({
            reason: `invalid_youbora_filters_json:${error instanceof Error ? error.message : String(error)}`,
          });
          params.logToolEnd("youbora_metrics_get", intent, blockedResult.details, startedAtMs);
          return blockedResult;
        }
      }

      const input = {
        fromDate: args.fromDate,
        ...(args.toDate ? { toDate: args.toDate } : {}),
        ...(args.metrics ? { metrics: args.metrics } : {}),
        ...(args.type ? { type: args.type } : {}),
        ...(args.granularity ? { granularity: args.granularity } : {}),
        ...(filters !== undefined ? { filters } : {}),
      };

      const result = await params.tooling.youboraMetricsGet({
        fromDate: args.fromDate,
        toDate: args.toDate,
        metrics: args.metrics,
        type: args.type,
        granularity: args.granularity,
        filters,
        clientId: args.clientId,
        timeoutMs: args.timeoutMs,
      });

      const text = [
        `ok=${result.ok}`,
        `taskId=${result.taskId}`,
        `capability=${result.capability}`,
        `fromDate=${args.fromDate}`,
        args.toDate ? `toDate=${args.toDate}` : "",
        args.metrics ? `metrics=${args.metrics}` : "",
        args.type ? `type=${args.type}` : "",
        args.granularity ? `granularity=${args.granularity}` : "",
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
        "youbora_metrics_get",
        intent,
        { status: result.ok ? "completed" : "failed", ...result, input },
        startedAtMs,
        result.ok ? `youbora_metrics_get ${args.fromDate}` : `youbora_metrics_get failed: ${result.error ?? "unknown"}`,
      );
      return response;
    },
  };

  const youboraRawdataGetTool: AgentTool = {
    name: "youbora_rawdata_get",
    label: "Youbora Rawdata Get",
    description:
      "Consulta sessoes brutas do Youbora via Clark/MCP usando a capability remota youbora.rawdata.get.",
    parameters: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Data inicial ou relativo, ex.: last24hours" },
        toDate: { type: "string", description: "Data final quando fromDate nao for relativo" },
        type: { type: "string", description: "Tipo de conteudo, ex.: vod ou live" },
        filtersJson: { type: "string", description: "Filtros adicionais em JSON serializado" },
        clientId: { type: "string", description: "ClientId especifico do Clark quando houver mais de um conectado" },
        timeoutMs: { type: "number", description: "Timeout total da task remota em milissegundos" },
      },
      required: ["fromDate"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveEdgeCall();
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        fromDate: string;
        toDate?: string;
        type?: string;
        filtersJson?: string;
        clientId?: string;
        timeoutMs?: number;
      };
      const intent = params.logToolStart("youbora_rawdata_get", args);
      let filters: unknown;
      if (args.filtersJson?.trim()) {
        try {
          filters = JSON.parse(args.filtersJson);
        } catch (error) {
          const blockedResult = params.makeBlockedResult({
            reason: `invalid_youbora_filters_json:${error instanceof Error ? error.message : String(error)}`,
          });
          params.logToolEnd("youbora_rawdata_get", intent, blockedResult.details, startedAtMs);
          return blockedResult;
        }
      }
      const result = await params.tooling.youboraRawdataGet({
        fromDate: args.fromDate,
        toDate: args.toDate,
        type: args.type,
        filters,
        clientId: args.clientId,
        timeoutMs: args.timeoutMs,
      });
      const text = [
        `ok=${result.ok}`,
        `taskId=${result.taskId}`,
        `capability=${result.capability}`,
        `fromDate=${args.fromDate}`,
        args.toDate ? `toDate=${args.toDate}` : "",
        args.type ? `type=${args.type}` : "",
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
        "youbora_rawdata_get",
        intent,
        { status: result.ok ? "completed" : "failed", ...result },
        startedAtMs,
        result.ok ? `youbora_rawdata_get ${args.fromDate}` : `youbora_rawdata_get failed: ${result.error ?? "unknown"}`,
      );
      return response;
    },
  };

  const youboraEventsGetTool: AgentTool = {
    name: "youbora_events_get",
    label: "Youbora Events Get",
    description:
      "Consulta eventos de player do Youbora via Clark/MCP usando a capability remota youbora.events.get.",
    parameters: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Data inicial ou relativo, ex.: last24hours" },
        toDate: { type: "string", description: "Data final quando fromDate nao for relativo" },
        type: { type: "string", description: "Tipo de conteudo, ex.: vod ou live" },
        filtersJson: { type: "string", description: "Filtros adicionais em JSON serializado" },
        clientId: { type: "string", description: "ClientId especifico do Clark quando houver mais de um conectado" },
        timeoutMs: { type: "number", description: "Timeout total da task remota em milissegundos" },
      },
      required: ["fromDate"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveEdgeCall();
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        fromDate: string;
        toDate?: string;
        type?: string;
        filtersJson?: string;
        clientId?: string;
        timeoutMs?: number;
      };
      const intent = params.logToolStart("youbora_events_get", args);
      let filters: unknown;
      if (args.filtersJson?.trim()) {
        try {
          filters = JSON.parse(args.filtersJson);
        } catch (error) {
          const blockedResult = params.makeBlockedResult({
            reason: `invalid_youbora_filters_json:${error instanceof Error ? error.message : String(error)}`,
          });
          params.logToolEnd("youbora_events_get", intent, blockedResult.details, startedAtMs);
          return blockedResult;
        }
      }
      const result = await params.tooling.youboraEventsGet({
        fromDate: args.fromDate,
        toDate: args.toDate,
        type: args.type,
        filters,
        clientId: args.clientId,
        timeoutMs: args.timeoutMs,
      });
      const text = [
        `ok=${result.ok}`,
        `taskId=${result.taskId}`,
        `capability=${result.capability}`,
        `fromDate=${args.fromDate}`,
        args.toDate ? `toDate=${args.toDate}` : "",
        args.type ? `type=${args.type}` : "",
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
        "youbora_events_get",
        intent,
        { status: result.ok ? "completed" : "failed", ...result },
        startedAtMs,
        result.ok ? `youbora_events_get ${args.fromDate}` : `youbora_events_get failed: ${result.error ?? "unknown"}`,
      );
      return response;
    },
  };

  return [listTool, callTool, youboraMetricsGetTool, youboraRawdataGetTool, youboraEventsGetTool];
}
