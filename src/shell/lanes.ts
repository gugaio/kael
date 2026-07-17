/**
 * Command Lanes — controle de concorrência por categoria de execução.
 *
 * Previne que comandos do agente (exec) e jobs de mídia (ffmpeg)
 * disputem recursos do sistema sem coordenação.
 */

export type LaneName = "agent" | "media" | "system";

export type LaneConfig = {
  /** Máximo de execuções simultâneas nesta lane. */
  concurrency: number;
};

const DEFAULT_LANE_CONFIGS: Record<LaneName, LaneConfig> = {
  agent: { concurrency: 1 },
  media: { concurrency: 2 },
  system: { concurrency: 4 },
};

type QueuedRun = {
  id: string;
  lane: LaneName;
  execute: () => Promise<void>;
};

/**
 * Gerenciador de lanes de execução.
 * Mantém fila por lane e controla concorrência.
 */
export class LaneQueue {
  private readonly configs: Map<LaneName, LaneConfig>;
  private readonly queues = new Map<LaneName, QueuedRun[]>();
  private readonly activeCounts = new Map<LaneName, number>();
  private nextId = 1;

  constructor(configs?: Partial<Record<LaneName, LaneConfig>>) {
    this.configs = new Map<LaneName, LaneConfig>();
    for (const [name, cfg] of Object.entries(DEFAULT_LANE_CONFIGS)) {
      const override = configs?.[name as LaneName];
      this.configs.set(name as LaneName, override ?? cfg);
    }
  }

  /**
   * Executa uma função em uma lane.
   * Se a lane estiver no limite de concorrência, enfileira.
   * Retorna uma promise que resolve quando a execução completa.
   */
  async runInLane<T>(lane: LaneName, fn: () => Promise<T>): Promise<T> {
    const id = String(this.nextId++);
    return new Promise<T>((resolve, reject) => {
      const execute = async (): Promise<void> => {
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          const curr = this.activeCounts.get(lane) ?? 1;
          this.activeCounts.set(lane, Math.max(0, curr - 1));
          this.drainLane(lane);
        }
      };

      const currentActive = this.activeCounts.get(lane) ?? 0;
      const maxConcurrent = this.configs.get(lane)?.concurrency ?? 1;

      if (currentActive < maxConcurrent) {
        this.activeCounts.set(lane, currentActive + 1);
        execute().catch(() => {}); // erro já tratado no resolve/reject
      } else {
        const queue = this.queues.get(lane) ?? [];
        queue.push({ id, lane, execute });
        this.queues.set(lane, queue);
      }
    });
  }

  /**
   * Retorna estatísticas atuais das lanes.
   */
  getStats(): Record<LaneName, { active: number; queued: number; maxConcurrent: number }> {
    const stats = {} as Record<LaneName, { active: number; queued: number; maxConcurrent: number }>;
    for (const [name, cfg] of this.configs) {
      stats[name] = {
        active: this.activeCounts.get(name) ?? 0,
        queued: (this.queues.get(name) ?? []).length,
        maxConcurrent: cfg.concurrency,
      };
    }
    return stats;
  }

  /** Libera um slot na lane. */
  private drainLane(lane: LaneName): void {
    const queue = this.queues.get(lane) ?? [];
    if (queue.length === 0) return;
    const next = queue.shift()!;
    if (queue.length === 0) {
      this.queues.delete(lane);
    } else {
      this.queues.set(lane, queue);
    }
    const currentActive = this.activeCounts.get(lane) ?? 0;
    this.activeCounts.set(lane, currentActive + 1);
    next.execute().catch(() => {});
  }

  /** Limpa todas as filas. */
  clear(): void {
    this.queues.clear();
    this.activeCounts.clear();
  }
}

/** Singleton global de lanes. */
let _globalLaneQueue: LaneQueue | null = null;

export function getGlobalLaneQueue(): LaneQueue {
  if (!_globalLaneQueue) {
    _globalLaneQueue = new LaneQueue();
  }
  return _globalLaneQueue;
}

export function resetGlobalLaneQueue(): void {
  _globalLaneQueue = null;
}
