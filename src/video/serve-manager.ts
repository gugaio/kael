import type {
  StreamerServeHandle,
  StreamerServeOptions,
  StreamerLiveServeHandle,
  StreamerLiveServeOptions,
} from "@gugaio/vhs";

export type ActiveServe = {
  originId: string;
  playbackUrl: string;
  baseUrl: string;
  live: boolean;
  windowSize?: number;
  initialMediaSequence?: number;
};

export class StreamServeManager {
  private handles = new Map<string, StreamerServeHandle | StreamerLiveServeHandle>();

  constructor(
    private serveFn: (originId: string, options?: StreamerServeOptions) => Promise<StreamerServeHandle>,
    private serveLiveFn: (originId: string, options?: StreamerLiveServeOptions) => Promise<StreamerLiveServeHandle>,
  ) {}

  async serve(originId: string, options?: StreamerServeOptions): Promise<ActiveServe> {
    const existing = this.handles.get(originId);
    if (existing) {
      return toActiveServe(existing);
    }
    const handle = await this.serveFn(originId, options);
    this.handles.set(originId, handle);
    return toActiveServe(handle);
  }

  async serveLive(originId: string, options?: StreamerLiveServeOptions): Promise<ActiveServe> {
    const existing = this.handles.get(originId);
    if (existing) {
      return toActiveServe(existing);
    }
    const handle = await this.serveLiveFn(originId, options);
    this.handles.set(originId, handle);
    return toActiveServe(handle);
  }

  async stop(originId: string): Promise<boolean> {
    const handle = this.handles.get(originId);
    if (!handle) {
      return false;
    }
    this.handles.delete(originId);
    await handle.close().catch(() => undefined);
    return true;
  }

  listServing(): ActiveServe[] {
    return Array.from(this.handles.values()).map(toActiveServe);
  }

  isServing(originId: string): boolean {
    return this.handles.has(originId);
  }

  async stopAll(): Promise<void> {
    const ids = Array.from(this.handles.keys());
    await Promise.all(ids.map((id) => this.stop(id)));
  }
}

function toActiveServe(handle: StreamerServeHandle | StreamerLiveServeHandle): ActiveServe {
  return {
    originId: handle.originId,
    playbackUrl: handle.playbackUrl,
    baseUrl: handle.baseUrl,
    live: "windowSize" in handle,
    ...("windowSize" in handle ? { windowSize: handle.windowSize } : {}),
    ...("initialMediaSequence" in handle ? { initialMediaSequence: handle.initialMediaSequence } : {}),
  };
}
