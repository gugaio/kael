import type { EngineToolingInterface } from "./types.js";

export type ToolingExecutionMode = "job" | "interactive" | "remote" | "service";

export type EngineToolingNamespaceDescriptor = {
  namespace: keyof EngineToolingInterface;
  executionMode: ToolingExecutionMode;
  executor: "processJobs" | "shellRuntime" | "mcpRuntime" | "edgeRuntime" | "browserRuntime" | "service";
  description: string;
};

export const ENGINE_TOOLING_NAMESPACE_DESCRIPTORS: EngineToolingNamespaceDescriptor[] = [
  {
    namespace: "video",
    executionMode: "job",
    executor: "processJobs",
    description: "Video pesado e operacional. Jobs persistentes, rastreaveis e cancelaveis.",
  },
  {
    namespace: "jobs",
    executionMode: "service",
    executor: "service",
    description: "Consulta e inspecao do estado dos jobs persistidos.",
  },
  {
    namespace: "system",
    executionMode: "interactive",
    executor: "shellRuntime",
    description: "Execucao e supervisao de comandos/processos do host.",
  },
  {
    namespace: "mcp",
    executionMode: "remote",
    executor: "mcpRuntime",
    description: "Bridge para ferramentas MCP locais/remotas via mcporter.",
  },
  {
    namespace: "edge",
    executionMode: "remote",
    executor: "edgeRuntime",
    description: "Dispatch remoto para runtimes satelite como Clark.",
  },
  {
    namespace: "memory",
    executionMode: "service",
    executor: "service",
    description: "Leitura e escrita em memoria operacional persistente.",
  },
  {
    namespace: "workspace",
    executionMode: "service",
    executor: "service",
    description: "Busca e leitura no workspace local.",
  },
  {
    namespace: "web",
    executionMode: "service",
    executor: "service",
    description: "Pesquisa e fetch web com cache, ranking e sintese.",
  },
  {
    namespace: "browser",
    executionMode: "interactive",
    executor: "browserRuntime",
    description: "Controle interativo e stateful de browser por sessao.",
  },
  {
    namespace: "image",
    executionMode: "service",
    executor: "service",
    description: "Geracao direta de imagem como artifact.",
  },
  {
    namespace: "plans",
    executionMode: "service",
    executor: "service",
    description: "Planejamento, execucao assistida e reconciliacao de planos.",
  },
];

export function getEngineToolingNamespaceDescriptor(
  namespace: keyof EngineToolingInterface,
): EngineToolingNamespaceDescriptor | undefined {
  return ENGINE_TOOLING_NAMESPACE_DESCRIPTORS.find((item) => item.namespace === namespace);
}
