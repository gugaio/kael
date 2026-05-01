import { randomUUID } from "node:crypto";
import type { VideoInspectToolService } from "./inspect-service.js";
import { analyzeSnapshotTransition, toStreamSnapshot } from "./stream-snapshot-analyzer.js";
import type {
  StreamSnapshot,
  StreamWatchEvent,
  StreamWatchParams,
  StreamWatchStatus,
} from "./types.js";

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_EVENTS = 500;

type WatchSession = {
  id: string;
  sessionKey: string;
  url: string;
  pollIntervalMs: number;
  timeoutMs: number;
  maxPollCount: number | undefined;
  maxEvents: number;
  startedAt: string;
  lastPollAt: string | null;
  pollCount: number;
  errorCount: number;
  events: StreamWatchEvent[];
  running: boolean;
  lastSnapshot: StreamSnapshot | null;
  timer: ReturnType<typeof setTimeout> | null;
};

/**
 * Serviço de monitoramento contínuo de streams HLS.
 *
 * Cada sessão de watch faz polling periódico do manifesto e compara
 * snapshots consecutivos com o StreamSnapshotAnalyzer para detectar anomalias
 * de qualidade em tempo real.
 */
export class HlsStreamMonitorService {
  private readonly sessions = new Map<string, WatchSession>();

  constructor(private readonly inspect: VideoInspectToolService) {}

  /**
   * Inicia uma nova sessão de monitoramento e retorna o ID da sessão.
   */
  startWatch(params: StreamWatchParams): string {
    const id = randomUUID();
    const pollIntervalMs = Math.max(
      MIN_POLL_INTERVAL_MS,
      params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    );

    const session: WatchSession = {
      id,
      sessionKey: params.sessionKey,
      url: params.url,
      pollIntervalMs,
      timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxPollCount: params.maxPollCount,
      maxEvents: params.maxEvents ?? DEFAULT_MAX_EVENTS,
      startedAt: new Date().toISOString(),
      lastPollAt: null,
      pollCount: 0,
      errorCount: 0,
      events: [],
      running: true,
      lastSnapshot: null,
      timer: null,
    };

    this.sessions.set(id, session);
    this.scheduleNextPoll(session);
    return id;
  }

  /**
   * Para uma sessão de monitoramento ativa.
   * Retorna true se a sessão existia e foi parada, false se não encontrada.
   */
  stopWatch(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.cancelSession(session);
    return true;
  }

  /**
   * Retorna o status atual de uma sessão (ou null se não existir).
   */
  getStatus(id: string): StreamWatchStatus | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    return toStatus(session);
  }

  /**
   * Lista todas as sessões ativas e encerradas.
   */
  listWatches(): StreamWatchStatus[] {
    return [...this.sessions.values()].map(toStatus);
  }

  /**
   * Para todas as sessões ativas (útil para shutdown graceful).
   */
  stopAll(): void {
    for (const session of this.sessions.values()) {
      if (session.running) {
        this.cancelSession(session);
      }
    }
  }

  // ─── Privado ──────────────────────────────────────────────────────────────

  private scheduleNextPoll(session: WatchSession): void {
    if (!session.running) return;
    session.timer = setTimeout(() => {
      void this.poll(session);
    }, session.pollIntervalMs);
  }

  private async poll(session: WatchSession): Promise<void> {
    if (!session.running) return;

    try {
      const fetchedAt = Date.now();
      const inspected = await this.inspect.inspectHls({
        url: session.url,
        maxSegments: 20,
        timeoutMs: session.timeoutMs,
      });

      session.pollCount += 1;
      session.lastPollAt = new Date().toISOString();

      const snapshot = toStreamSnapshot(inspected, fetchedAt);

      if (session.lastSnapshot !== null) {
        const newEvents = analyzeSnapshotTransition(session.lastSnapshot, snapshot);
        if (newEvents.length > 0) {
          for (const event of newEvents) {
            session.events.push(event);
          }
          // Rotaciona eventos antigos se exceder o limite
          if (session.events.length > session.maxEvents) {
            session.events = session.events.slice(session.events.length - session.maxEvents);
          }
        }
      }

      session.lastSnapshot = snapshot;
    } catch (error) {
      session.errorCount += 1;
      session.lastPollAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      session.events.push({
        code: "poll_error",
        severity: "error",
        summary: `Erro ao buscar manifesto: ${message}`,
        evidence: [`url=${session.url}`, `error=${message}`],
        detectedAt: new Date().toISOString(),
      });
    }

    // Verifica se atingiu o limite de polls
    if (
      session.maxPollCount !== undefined &&
      session.pollCount >= session.maxPollCount
    ) {
      this.cancelSession(session);
      return;
    }

    this.scheduleNextPoll(session);
  }

  private cancelSession(session: WatchSession): void {
    session.running = false;
    if (session.timer !== null) {
      clearTimeout(session.timer);
      session.timer = null;
    }
  }
}

function toStatus(session: WatchSession): StreamWatchStatus {
  return {
    id: session.id,
    sessionKey: session.sessionKey,
    url: session.url,
    startedAt: session.startedAt,
    lastPollAt: session.lastPollAt,
    pollCount: session.pollCount,
    errorCount: session.errorCount,
    events: [...session.events],
    running: session.running,
  };
}
