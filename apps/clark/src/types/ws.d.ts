declare module 'ws' {
  import { EventEmitter } from 'node:events';
  import type { Server } from 'node:http';

  export type RawData = Buffer | ArrayBuffer | Buffer[];

  export default class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    readonly readyState: number;

    constructor(url: string);

    send(data: string): void;
    close(): void;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options: { port?: number; server?: Server });
    address(): { port: number; family: string; address: string } | string | null;
    close(callback?: (error?: Error) => void): void;
  }
}
