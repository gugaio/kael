declare module "@clappr/player" {
  export type ClapprPlayerOptions = {
    source: string;
    parent: HTMLElement;
    plugins?: unknown[];
    width?: string | number;
    height?: string | number;
    autoPlay?: boolean;
    mute?: boolean;
    hlsPlayback?: {
      preload?: boolean;
      customListeners?: Array<{
        eventName: string;
        callback: (event: string, data: unknown) => void;
        once?: boolean;
      }>;
    };
    playback?: {
      hlsjsConfig?: Record<string, unknown>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };

  export type ClapprPlayerInstance = {
    destroy(): void;
    configure(options: Partial<ClapprPlayerOptions>): void;
  };

  const Clappr: {
    Player: new (options: ClapprPlayerOptions) => ClapprPlayerInstance;
  };

  export default Clappr;
}

declare module "@clappr/hlsjs-playback" {
  const HlsjsPlayback: unknown;
  export default HlsjsPlayback;
}
