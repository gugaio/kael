import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { MemoryService } from "../../memory/service.js";

type TextBlock = {
  type: "text";
  text: string;
};

export function createMemoryPiTools(params: {
  memory: MemoryService;
  textResult: (text: string) => TextBlock[];
  logToolStart: (tool: string, rawParams: unknown) => string;
  logToolEnd: (
    tool: string,
    intent: string,
    result: unknown,
    startedAtMs: number,
    summary?: string,
  ) => void;
}): AgentTool[] {
  const memorySearchTool: AgentTool = {
    name: "memory_search",
    label: "Memory Search",
    description:
      "Busca semantica simplificada em MEMORY.md e memory/*.md. Use SEMPRE antes de responder sobre fatos pessoais/historicos (ex: meu time, preferencias, decisoes, combinados).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Consulta de memoria" },
        maxResults: { type: "number", description: "Quantidade maxima de snippets" },
      },
      required: ["query"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as { query: string; maxResults?: number };
      const intent = params.logToolStart("memory_search", args);
      try {
        const results = await params.memory.search(args.query, args.maxResults);
        const text =
          results.length === 0
            ? "results=0"
            : [
                `results=${results.length}`,
                ...results.map(
                  (item, idx) =>
                    `${idx + 1}. ${item.path}#L${item.startLine}-L${item.endLine} score=${item.score}\n${item.snippet}`,
                ),
              ].join("\n\n");
        const details = { results };
        params.logToolEnd(
          "memory_search",
          intent,
          {
            status: "completed",
            resultCount: results.length,
            topPaths: results.slice(0, 5).map((r) => `${r.path}:${r.startLine}-${r.endLine}`),
          },
          startedAtMs,
        );
        return {
          content: params.textResult(text),
          details,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logToolEnd("memory_search", intent, { status: "failed", reason: message }, startedAtMs);
        throw error;
      }
    },
  };

  const memoryGetTool: AgentTool = {
    name: "memory_get",
    label: "Memory Get",
    description:
      "Le trecho de MEMORY.md ou memory/*.md por path e opcionalmente intervalo de linhas. Use para confirmar evidencias retornadas por memory_search antes de responder.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relativo (MEMORY.md ou memory/*.md)" },
        from: { type: "number", description: "Linha inicial (1-based)" },
        lines: { type: "number", description: "Quantidade de linhas" },
      },
      required: ["path"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as { path: string; from?: number; lines?: number };
      const intent = params.logToolStart("memory_get", args);
      try {
        const result = await params.memory.get({
          relPath: args.path,
          from: args.from,
          lines: args.lines,
        });
        const text = `${result.path}#L${result.startLine}-L${result.endLine}\n${result.text}`;
        params.logToolEnd("memory_get", intent, { status: "completed", path: result.path }, startedAtMs);
        return {
          content: params.textResult(text),
          details: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logToolEnd("memory_get", intent, { status: "failed", reason: message }, startedAtMs);
        throw error;
      }
    },
  };

  const memoryWriteTool: AgentTool = {
    name: "memory_write",
    label: "Memory Write",
    description:
      "Persiste memoria operacional. target=daily para notas do dia; target=long_term para decisoes/preferencias duraveis.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Conteudo a persistir" },
        target: {
          type: "string",
          enum: ["daily", "long_term"],
          description: "Destino da memoria",
        },
      },
      required: ["content"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as { content: string; target?: "daily" | "long_term" };
      const intent = params.logToolStart("memory_write", args);
      try {
        const saved = await params.memory.write({
          content: args.content,
          target: args.target,
        });
        params.logToolEnd("memory_write", intent, { status: "completed", path: saved.path }, startedAtMs);
        return {
          content: params.textResult(`saved=true\npath=${saved.path}`),
          details: saved,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logToolEnd("memory_write", intent, { status: "failed", reason: message }, startedAtMs);
        throw error;
      }
    },
  };

  return [memorySearchTool, memoryGetTool, memoryWriteTool];
}
