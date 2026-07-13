import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { EngineToolingInterface } from "../../agents/types.js";

type TextBlock = {
  type: "text";
  text: string;
};

export function createProjectsPiTools(params: {
  tooling: EngineToolingInterface["projects"];
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
  const projectSearchTool: AgentTool = {
    name: "project_search",
    label: "Project Search",
    description: "Busca no project space do Kael por documentos Markdown dentro de `.kael/projects/<project>/`.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        project: { type: "string" },
        maxResults: { type: "number" },
      },
      required: ["query"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as { query: string; project?: string; maxResults?: number };
      const intent = params.logToolStart("project_search", args);
      try {
        const results = await params.tooling.projectSearch(args);
        const text =
          results.length === 0
            ? "results=0"
            : [
                `results=${results.length}`,
                ...results.map(
                  (item, idx) =>
                    `${idx + 1}. ${item.project}/${item.path} score=${item.score}\ntitle=${item.title}\ndescription=${item.description}\n${item.snippet}`,
                ),
              ].join("\n\n");
        params.logToolEnd("project_search", intent, { status: "completed", resultCount: results.length }, startedAtMs);
        return { content: params.textResult(text), details: { results } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logToolEnd("project_search", intent, { status: "failed", reason: message }, startedAtMs);
        throw error;
      }
    },
  };

  const projectGetDocumentTool: AgentTool = {
    name: "project_get_document",
    label: "Project Get Document",
    description: "Le um documento do project space, como `PROJECT.md` ou `params.md`.",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string" },
        path: { type: "string" },
      },
      required: ["project"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as { project: string; path?: string };
      const intent = params.logToolStart("project_get_document", args);
      try {
        const result = await params.tooling.projectGetDocument(args);
        if (!result) {
          params.logToolEnd("project_get_document", intent, { status: "completed", found: false }, startedAtMs);
          return { content: params.textResult("found=false"), details: { found: false } };
        }
        const text = [
          "found=true",
          `project=${result.project}`,
          `path=${result.path}`,
          `title=${result.title}`,
          `description=${result.description}`,
          `updatedAt=${result.updatedAt}`,
          `content=${result.content}`,
        ].join("\n");
        params.logToolEnd("project_get_document", intent, { status: "completed", found: true, path: result.path }, startedAtMs);
        return { content: params.textResult(text), details: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logToolEnd("project_get_document", intent, { status: "failed", reason: message }, startedAtMs);
        throw error;
      }
    },
  };

  const projectUpsertDocumentTool: AgentTool = {
    name: "project_upsert_document",
    label: "Project Upsert Document",
    description: "Cria ou atualiza um documento Markdown no project space e registra o arquivo no `index.json`.",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string" },
        path: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        content: { type: "string" },
        mode: { type: "string", enum: ["replace", "append"] },
      },
      required: ["project", "content"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as Parameters<EngineToolingInterface["projects"]["projectUpsertDocument"]>[0];
      const intent = params.logToolStart("project_upsert_document", args);
      try {
        const result = await params.tooling.projectUpsertDocument(args);
        params.logToolEnd("project_upsert_document", intent, { status: "completed", path: result.path }, startedAtMs);
        return {
          content: params.textResult(`saved=true\nproject=${result.project}\npath=${result.path}\ntitle=${result.title}`),
          details: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logToolEnd("project_upsert_document", intent, { status: "failed", reason: message }, startedAtMs);
        throw error;
      }
    },
  };

  const projectListDocumentsTool: AgentTool = {
    name: "project_list_documents",
    label: "Project List Documents",
    description: "Lista os documentos registrados no `index.json` de um projeto.",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string" },
      },
      required: ["project"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as { project: string };
      const intent = params.logToolStart("project_list_documents", args);
      try {
        const results = await params.tooling.projectListDocuments(args);
        const text =
          results.length === 0
            ? "results=0"
            : [
                `results=${results.length}`,
                ...results.map((item, idx) => `${idx + 1}. path=${item.path} title=${item.title}\ndescription=${item.description}`),
              ].join("\n\n");
        params.logToolEnd("project_list_documents", intent, { status: "completed", resultCount: results.length }, startedAtMs);
        return { content: params.textResult(text), details: { results } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logToolEnd("project_list_documents", intent, { status: "failed", reason: message }, startedAtMs);
        throw error;
      }
    },
  };

  return [projectSearchTool, projectGetDocumentTool, projectUpsertDocumentTool, projectListDocumentsTool];
}
