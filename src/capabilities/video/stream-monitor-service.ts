import type { HlsWatchService, HlsWatchStatus } from "@gugaio/vhs";
import type { StreamWatchParams, StreamWatchStatus } from "./types.js";

/**
 * Adapta o monitor HLS do VHS ao contrato de sessao do Kael.
 *
 * VHS monitora streams; Kael associa cada watch a uma sessao de agente.
 */
export class HlsStreamMonitorService {
  private readonly sessionKeys = new Map<string, string>();

  constructor(private readonly watch: HlsWatchService) {}

  startWatch(params: StreamWatchParams): string {
    const id = this.watch.startWatch({
      url: params.url,
      pollIntervalMs: params.pollIntervalMs,
      maxPollCount: params.maxPollCount,
      timeoutMs: params.timeoutMs,
      maxEvents: params.maxEvents,
    });
    this.sessionKeys.set(id, params.sessionKey);
    return id;
  }

  stopWatch(id: string): boolean {
    return this.watch.stopWatch(id);
  }

  getStatus(id: string): StreamWatchStatus | null {
    const status = this.watch.getStatus(id);
    return status ? this.toKaelStatus(status) : null;
  }

  listWatches(): StreamWatchStatus[] {
    return this.watch.listWatches().map((status) => this.toKaelStatus(status));
  }

  stopAll(): void {
    this.watch.stopAll();
  }

  private toKaelStatus(status: HlsWatchStatus): StreamWatchStatus {
    return {
      ...status,
      sessionKey: this.sessionKeys.get(status.id) ?? "unknown",
    };
  }
}
