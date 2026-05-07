import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { EngineToolingInterface } from "../types.js";
import type { ToolLoopGuard } from "../tool-loop-guard.js";

type TextBlock = {
  type: "text";
  text: string;
};

function summarizeWebSearch(result: { answer?: string; sources?: Array<{ title?: string; url?: string }> }) {
  const top = (result.sources ?? [])
    .slice(0, 3)
    .map((item) => `${item.title ?? "fonte"} | ${item.url ?? "n/a"}`);
  if (top.length === 0) {
    return "";
  }
  const answer = typeof result.answer === "string" ? result.answer.replace(/\s+/g, " ").slice(0, 180) : "";
  return [`web_search`, ...top, answer ? `resumo=${answer}` : ""].filter(Boolean).join(" | ");
}

function summarizeWebFetch(result: { title?: string; finalUrl?: string; excerpt?: string }) {
  const excerpt = typeof result.excerpt === "string" ? result.excerpt.replace(/\s+/g, " ").slice(0, 180) : "";
  return [
    "web_fetch",
    result.title ? `titulo=${result.title.slice(0, 80)}` : "",
    result.finalUrl ? `url=${result.finalUrl}` : "",
    excerpt ? `trecho=${excerpt}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function summarizeWebResearch(result: {
  summary?: string;
  confidence?: number;
  evidence?: Array<{ source?: { title?: string; url?: string } }>;
}) {
  const evidence = (result.evidence ?? [])
    .slice(0, 3)
    .map((item) => `${item.source?.title ?? "fonte"} | ${item.source?.url ?? "n/a"}`);
  const summary = typeof result.summary === "string" ? result.summary.replace(/\s+/g, " ").slice(0, 180) : "";
  return [
    "web_research",
    typeof result.confidence === "number" ? `confianca=${result.confidence}` : "",
    ...evidence,
    summary ? `resumo=${summary}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

export function createWebPiTools(params: {
  sessionKey: string;
  tooling: EngineToolingInterface["web"];
  turnSignal?: AbortSignal;
  loopGuard?: ToolLoopGuard;
  textResult: (text: string) => TextBlock[];
  makeBlockedResult: (params: {
    reason: string;
    retryAfterMs?: number;
    nextAction?: string;
  }) => { content: TextBlock[]; details: unknown };
  reserveWebCall: (
    tool: "web_search" | "web_fetch" | "web_research",
  ) => { blocked: { content: TextBlock[]; details: unknown } } | null;
  logToolStart: (tool: string, rawParams: unknown) => string;
  logToolEnd: (
    tool: string,
    intent: string,
    result: unknown,
    startedAtMs: number,
    summary?: string,
  ) => void;
}): AgentTool[] {
  const webSearchTool: AgentTool = {
    name: "web_search",
    label: "Web Search",
    description:
      "Pesquisa na web com citacao de fontes. Use para fatos atuais, confirmacao externa e comparacao de opcoes.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Consulta de pesquisa" },
        maxResults: { type: "number", description: "Quantidade maxima de fontes" },
        recencyDays: { type: "number", description: "Recencia em dias (opcional)" },
        domainsAllow: { type: "array", items: { type: "string" } },
        domainsBlock: { type: "array", items: { type: "string" } },
      },
      required: ["query"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveWebCall("web_search");
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        query: string;
        maxResults?: number;
        recencyDays?: number;
        domainsAllow?: string[];
        domainsBlock?: string[];
      };
      const intent = params.logToolStart("web_search", args);
      const decision = params.loopGuard?.beforeCall({
        sessionKey: params.sessionKey,
        tool: "web_search",
        params: args,
      });
      if (decision && !decision.allowed) {
        const blockedResult = params.makeBlockedResult({
          reason: decision.reason,
          retryAfterMs: decision.retryAfterMs,
          nextAction: "finalize_answer_with_available_evidence",
        });
        params.logToolEnd("web_search", intent, blockedResult.details, startedAtMs);
        return blockedResult;
      }
      const result = await params.tooling.webSearch({
        sessionKey: params.sessionKey,
        query: args.query,
        maxResults: args.maxResults,
        recencyDays: args.recencyDays,
        domainsAllow: args.domainsAllow,
        domainsBlock: args.domainsBlock,
        signal: params.turnSignal,
      });
      params.loopGuard?.afterCall({
        sessionKey: params.sessionKey,
        tool: "web_search",
        params: args,
        result,
      });
      const text = [
        `sources=${result.sources.length}`,
        "answer:",
        result.answer,
        "",
        "sources_list:",
        ...result.sources.map((item, idx) => `${idx + 1}. ${item.title} | ${item.url}`),
        ...(result.notes.length > 0 ? ["", "notes:", ...result.notes.map((item) => `- ${item}`)] : []),
      ].join("\n");
      const response = {
        content: params.textResult(text),
        details: result,
      };
      params.logToolEnd(
        "web_search",
        intent,
        { status: "completed", ...result },
        startedAtMs,
        summarizeWebSearch(result),
      );
      return response;
    },
  };

  const webFetchTool: AgentTool = {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Baixa uma URL e extrai texto limpo para leitura resumida. Use para aprofundar uma fonte do web_search.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL http/https para extrair conteudo" },
        maxChars: { type: "number", description: "Limite maximo de caracteres de conteudo" },
      },
      required: ["url"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveWebCall("web_fetch");
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as { url: string; maxChars?: number };
      const intent = params.logToolStart("web_fetch", args);
      const decision = params.loopGuard?.beforeCall({
        sessionKey: params.sessionKey,
        tool: "web_fetch",
        params: args,
      });
      if (decision && !decision.allowed) {
        const blockedResult = params.makeBlockedResult({
          reason: decision.reason,
          retryAfterMs: decision.retryAfterMs,
          nextAction: "finalize_answer_with_available_evidence",
        });
        params.logToolEnd("web_fetch", intent, blockedResult.details, startedAtMs);
        return blockedResult;
      }
      const result = await params.tooling.webFetch({
        sessionKey: params.sessionKey,
        url: args.url,
        maxChars: args.maxChars,
        signal: params.turnSignal,
      });
      params.loopGuard?.afterCall({
        sessionKey: params.sessionKey,
        tool: "web_fetch",
        params: args,
        result,
      });
      const text = [
        `url=${result.url}`,
        `finalUrl=${result.finalUrl}`,
        `cached=${result.cached}`,
        result.title ? `title=${result.title}` : "",
        result.contentType ? `contentType=${result.contentType}` : "",
        "excerpt:",
        result.excerpt,
      ]
        .filter(Boolean)
        .join("\n");
      const response = {
        content: params.textResult(text),
        details: result,
      };
      params.logToolEnd(
        "web_fetch",
        intent,
        { status: "completed", ...result },
        startedAtMs,
        summarizeWebFetch(result),
      );
      return response;
    },
  };

  const webResearchTool: AgentTool = {
    name: "web_research",
    label: "Web Research",
    description:
      "Executa pesquisa completa (search + fetch de fontes) e retorna resumo com evidencias e nivel de confianca.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Pergunta/tema de pesquisa" },
        maxResults: { type: "number", description: "Quantidade maxima de fontes de busca" },
        fetchTop: { type: "number", description: "Quantidade de fontes para web_fetch automatico" },
        fetchMaxChars: { type: "number", description: "Limite de texto por fonte fetched" },
        recencyDays: { type: "number", description: "Recencia em dias (opcional)" },
        domainsAllow: { type: "array", items: { type: "string" } },
        domainsBlock: { type: "array", items: { type: "string" } },
      },
      required: ["query"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveWebCall("web_research");
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        query: string;
        maxResults?: number;
        fetchTop?: number;
        fetchMaxChars?: number;
        recencyDays?: number;
        domainsAllow?: string[];
        domainsBlock?: string[];
      };
      const intent = params.logToolStart("web_research", args);
      const decision = params.loopGuard?.beforeCall({
        sessionKey: params.sessionKey,
        tool: "web_research",
        params: args,
      });
      if (decision && !decision.allowed) {
        const blockedResult = params.makeBlockedResult({
          reason: decision.reason,
          retryAfterMs: decision.retryAfterMs,
          nextAction: "finalize_answer_with_available_evidence",
        });
        params.logToolEnd("web_research", intent, blockedResult.details, startedAtMs);
        return blockedResult;
      }
      const result = await params.tooling.webResearch({
        sessionKey: params.sessionKey,
        query: args.query,
        maxResults: args.maxResults,
        fetchTop: args.fetchTop,
        fetchMaxChars: args.fetchMaxChars,
        recencyDays: args.recencyDays,
        domainsAllow: args.domainsAllow,
        domainsBlock: args.domainsBlock,
        signal: params.turnSignal,
      });
      params.loopGuard?.afterCall({
        sessionKey: params.sessionKey,
        tool: "web_research",
        params: args,
        result,
      });
      const text = [
        `confidence=${result.confidence}`,
        `confidenceReason=${result.confidenceReason}`,
        "",
        "summary:",
        result.summary,
        "",
        "evidence:",
        ...result.evidence
          .slice(0, 6)
          .map(
            (item, idx) =>
              `${idx + 1}. ${item.source.title} | ${item.source.url}${item.fetch ? " | fetched=true" : ""}`,
          ),
        ...(result.notes.length > 0 ? ["", "notes:", ...result.notes.map((item) => `- ${item}`)] : []),
      ].join("\n");
      const response = {
        content: params.textResult(text),
        details: result,
      };
      params.logToolEnd(
        "web_research",
        intent,
        { status: "completed", ...result },
        startedAtMs,
        summarizeWebResearch(result),
      );
      return response;
    },
  };

  return [webSearchTool, webFetchTool, webResearchTool];
}
