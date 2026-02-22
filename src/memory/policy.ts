import type { SessionMessage } from "../types.js";
import type { HeuristicDailyFlushNote, MemoryPolicy } from "./types.js";

export function isCompactCommand(input: string): boolean {
  return input.trim().toLowerCase() === "/compact";
}

export function todayMemoryRelPath(now = new Date()): string {
  return `memory/${now.toISOString().slice(0, 10)}.md`;
}

export function clipForMemory(input: string, maxChars = 220): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function buildMemoryFlushPrompt(): string {
  return [
    "Memory flush de compactacao manual.",
    "Analise o contexto recente da sessao e salve SOMENTE memorias realmente uteis.",
    "Escreva em memoria diaria usando memory_write(target='daily').",
    "Se houver fato duravel novo ou atualizacao importante (preferencia, identidade, ambiente, projeto), voce TAMBEM pode escrever em memory_write(target='long_term').",
    "Evite duplicatas literais. Seja conciso.",
    "Se nao houver nada util para salvar, responda apenas: NO_MEMORY_FLUSH",
    "Nao execute shell, nao use tools de video, nao use plans.",
  ].join(" ");
}

export function buildLongTermPromotionPrompt(): string {
  return [
    "Promocao de memoria de longo prazo apos memory flush/compactacao.",
    "Revise o contexto recente e promova SOMENTE fatos duraveis e uteis (preferencias, identidade, ambiente, padroes de uso, configuracoes estaveis, objetivos persistentes).",
    "Antes de escrever, consulte memoria existente com memory_search/memory_get para evitar duplicatas e para atualizar fatos existentes.",
    "Se precisar salvar, use memory_write(target='long_term').",
    "Nao replique logs, respostas temporarias, ou detalhes passageiros.",
    "Se nao houver nada para promover, responda apenas: NO_LONG_TERM_PROMOTION",
    "Nao use shell, nao use video, nao use plans.",
  ].join(" ");
}

export function buildHeuristicDailyFlushNote(params: {
  sessionKey: string;
  currentMessage: string;
  history: SessionMessage[];
}): HeuristicDailyFlushNote | null {
  const conversational = params.history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => !(m.role === "user" && m.content === params.currentMessage));

  const recent = conversational.slice(-12);
  if (recent.length < 2) {
    return null;
  }

  const first = recent[0]?.createdAt ?? "";
  const last = recent[recent.length - 1]?.createdAt ?? "";
  const bullets = recent.map((m) => `- ${m.role}: ${clipForMemory(m.content)}`).join("\n");
  const note = [
    "[manual-compact] Resumo heuristico de contexto antes da compactacao.",
    `session=${params.sessionKey}`,
    `janela=${first} -> ${last}`,
    `mensagens=${recent.length}`,
    "trechos:",
    bullets,
  ].join("\n");

  return {
    note,
    includedMessages: recent.length,
    reason: "heuristic_fallback",
  };
}

export class DefaultMemoryPolicy implements MemoryPolicy {
  isCompactCommand(input: string): boolean {
    return isCompactCommand(input);
  }
  todayDailyRelPath(now?: Date): string {
    return todayMemoryRelPath(now);
  }
  buildMemoryFlushPrompt(): string {
    return buildMemoryFlushPrompt();
  }
  buildLongTermPromotionPrompt(): string {
    return buildLongTermPromotionPrompt();
  }
  buildHeuristicDailyFlushNote(params: {
    sessionKey: string;
    currentMessage: string;
    history: SessionMessage[];
  }): HeuristicDailyFlushNote | null {
    return buildHeuristicDailyFlushNote(params);
  }
}
