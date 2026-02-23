import type { MemorySearchResult } from "./service.js";
import { BuiltinMemoryRetriever } from "./retriever.js";
import type { MemoryRetriever, MemorySearchQuery } from "./types.js";

type HybridMemoryRetrieverConfig = {
  lexical?: MemoryRetriever;
};

/**
 * Stub de retriever híbrido.
 * Hoje delega para o retriever lexical builtin.
 * Próxima etapa: combinar lexical + semantic + rerank.
 */
export class HybridMemoryRetriever implements MemoryRetriever {
  private readonly lexical: MemoryRetriever;

  constructor(cfg: HybridMemoryRetrieverConfig = {}) {
    this.lexical = cfg.lexical ?? new BuiltinMemoryRetriever();
  }

  search(params: MemorySearchQuery): MemorySearchResult[] {
    return this.lexical.search(params);
  }
}

