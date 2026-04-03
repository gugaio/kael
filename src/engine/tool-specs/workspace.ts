import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { EngineToolingNamespaces } from "../types.js";

type TextBlock = {
  type: "text";
  text: string;
};

export function createWorkspacePiTools(params: {
  tooling: EngineToolingNamespaces["workspace"];
  textResult: (text: string) => TextBlock[];
}): AgentTool[] {
  const workspaceSearchTool: AgentTool = {
    name: "workspace_search",
    label: "Workspace Search",
    description:
      "Busca texto no workspace do Kael (docs, src, config) para responder perguntas sobre arquitetura e implementacao atual.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto a localizar no workspace" },
        maxResults: { type: "number", description: "Quantidade maxima de ocorrencias" },
      },
      required: ["query"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as { query: string; maxResults?: number };
      const hits = await params.tooling.workspaceSearch({
        query: args.query,
        maxResults: args.maxResults,
      });
      const text =
        hits.length === 0
          ? "hits=0"
          : [`hits=${hits.length}`, ...hits.map((hit, i) => `${i + 1}. ${hit.path}:${hit.line} ${hit.snippet}`)].join(
              "\n",
            );
      return {
        content: params.textResult(text),
        details: { hits },
      };
    },
  };

  const workspaceReadTool: AgentTool = {
    name: "workspace_read",
    label: "Workspace Read",
    description:
      "Le trecho de arquivo do workspace (somente leitura) para confirmar detalhes do proprio Kael com evidencias.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relativo ao workspace" },
        from: { type: "number", description: "Linha inicial (1-based)" },
        lines: { type: "number", description: "Quantidade de linhas" },
      },
      required: ["path"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as { path: string; from?: number; lines?: number };
      const result = await params.tooling.workspaceRead({
        path: args.path,
        from: args.from,
        lines: args.lines,
      });
      return {
        content: params.textResult(`${result.path}#L${result.startLine}-L${result.endLine}\n${result.text}`),
        details: result,
      };
    },
  };

  return [workspaceSearchTool, workspaceReadTool];
}
