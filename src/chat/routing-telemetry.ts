export type ChatRouteKind = "compact" | "fast_path" | "llm_turn";

export type ChatRoutingTelemetrySnapshot = {
  total: number;
  compact: number;
  fastPath: number;
  llmTurn: number;
  lastRouteKind: ChatRouteKind | null;
  lastRouteAt: string | null;
};

export class ChatRoutingTelemetry {
  private total = 0;
  private compact = 0;
  private fastPath = 0;
  private llmTurn = 0;
  private lastRouteKind: ChatRouteKind | null = null;
  private lastRouteAt: string | null = null;

  record(kind: ChatRouteKind): void {
    this.total += 1;
    this.lastRouteKind = kind;
    this.lastRouteAt = new Date().toISOString();

    if (kind === "compact") {
      this.compact += 1;
      return;
    }
    if (kind === "fast_path") {
      this.fastPath += 1;
      return;
    }
    this.llmTurn += 1;
  }

  snapshot(): ChatRoutingTelemetrySnapshot {
    return {
      total: this.total,
      compact: this.compact,
      fastPath: this.fastPath,
      llmTurn: this.llmTurn,
      lastRouteKind: this.lastRouteKind,
      lastRouteAt: this.lastRouteAt,
    };
  }
}
