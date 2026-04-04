import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { EngineToolingNamespaces } from "../types.js";

type TextBlock = {
  type: "text";
  text: string;
};

export function createKnowledgePiTools(params: {
  tooling: EngineToolingNamespaces["knowledge"];
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
  const knowledgeSearchTool: AgentTool = {
    name: "knowledge_search",
    label: "Knowledge Search",
    description:
      "Busca na wiki operacional/knowledge base do Kael por fatos curados de projetos, analises anteriores, evidencias e convencoes de implementacao.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Pergunta ou consulta de busca" },
        project: { type: "string", description: "Projeto alvo opcional" },
        kind: { type: "string", enum: ["fact", "analysis", "decision"], description: "Tipo da nota" },
        tag: { type: "string", description: "Tag opcional" },
        status: { type: "string", enum: ["draft", "curated", "stale", "conflicting"] },
        maxResults: { type: "number", description: "Quantidade maxima de resultados" },
      },
      required: ["query"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        query: string;
        project?: string;
        kind?: "fact" | "analysis" | "decision";
        tag?: string;
        status?: "draft" | "curated" | "stale" | "conflicting";
        maxResults?: number;
      };
      const intent = params.logToolStart("knowledge_search", args);
      try {
        const results = await params.tooling.knowledgeSearch(args);
        const text =
          results.length === 0
            ? "results=0"
            : [
                `results=${results.length}`,
                ...results.map(
                  (item, idx) =>
                    `${idx + 1}. ${item.project}/${item.topic} id=${item.id} kind=${item.kind} status=${item.status} confidence=${item.confidence} score=${item.score}\n${item.snippet}`,
                ),
              ].join("\n\n");
        params.logToolEnd("knowledge_search", intent, { status: "completed", resultCount: results.length }, startedAtMs);
        return { content: params.textResult(text), details: { results } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logToolEnd("knowledge_search", intent, { status: "failed", reason: message }, startedAtMs);
        throw error;
      }
    },
  };

  const knowledgeGetTool: AgentTool = {
    name: "knowledge_get",
    label: "Knowledge Get",
    description: "Le uma nota específica da knowledge base do Kael por noteId.",
    parameters: {
      type: "object",
      properties: {
        noteId: { type: "string", description: "Id da nota" },
      },
      required: ["noteId"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as { noteId: string };
      const intent = params.logToolStart("knowledge_get", args);
      try {
        const result = await params.tooling.knowledgeGet({ noteId: args.noteId });
        if (!result) {
          params.logToolEnd("knowledge_get", intent, { status: "completed", found: false }, startedAtMs);
          return { content: params.textResult("found=false"), details: { found: false } };
        }
        const text = [
          "found=true",
          `id=${result.id}`,
          `project=${result.project}`,
          `topic=${result.topic}`,
          `kind=${result.kind}`,
          `title=${result.title}`,
          `status=${result.status}`,
          `confidence=${result.confidence}`,
          ...(result.summary ? [`summary=${result.summary}`] : []),
          `answer=${result.answer}`,
        ].join("\n");
        params.logToolEnd("knowledge_get", intent, { status: "completed", found: true, id: result.id }, startedAtMs);
        return { content: params.textResult(text), details: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logToolEnd("knowledge_get", intent, { status: "failed", reason: message }, startedAtMs);
        throw error;
      }
    },
  };

  const knowledgeUpsertTool: AgentTool = {
    name: "knowledge_upsert",
    label: "Knowledge Upsert",
    description:
      "Cria ou atualiza uma nota estruturada da wiki operacional do Kael com resposta, evidencias, arquivos e confidence.",
    parameters: {
      type: "object",
      properties: {
        noteId: { type: "string" },
        project: { type: "string" },
        topic: { type: "string" },
        kind: { type: "string", enum: ["fact", "analysis", "decision"] },
        title: { type: "string" },
        question: { type: "string" },
        answer: { type: "string" },
        summary: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        files: { type: "array", items: { type: "string" } },
        evidence: { type: "array", items: { type: "string" } },
        status: { type: "string", enum: ["draft", "curated", "stale", "conflicting"] },
        confidence: { type: "number" },
        updatedBy: { type: "string" },
        source: { type: "string" },
      },
      required: ["project", "topic", "answer"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as Parameters<EngineToolingNamespaces["knowledge"]["knowledgeUpsert"]>[0];
      const intent = params.logToolStart("knowledge_upsert", args);
      try {
        const result = await params.tooling.knowledgeUpsert(args);
        params.logToolEnd("knowledge_upsert", intent, { status: "completed", id: result.id }, startedAtMs);
        return {
          content: params.textResult(`saved=true\nid=${result.id}\nproject=${result.project}\ntopic=${result.topic}`),
          details: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logToolEnd("knowledge_upsert", intent, { status: "failed", reason: message }, startedAtMs);
        throw error;
      }
    },
  };

  return [knowledgeSearchTool, knowledgeGetTool, knowledgeUpsertTool];
}
