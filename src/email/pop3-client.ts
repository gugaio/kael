import tls from "node:tls";

type Pop3CommandResult = {
  ok: boolean;
  statusLine: string;
  lines: string[];
};

export class Pop3Client {
  private socket: tls.TLSSocket | null = null;
  private buffer = "";

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number,
  ) {}

  async connect(): Promise<void> {
    this.socket = tls.connect({
      host: this.host,
      port: this.port,
      servername: this.host,
      rejectUnauthorized: true,
    });
    this.socket.setEncoding("utf8");
    this.socket.setTimeout(this.timeoutMs);
    await onceEvent(this.socket, "secureConnect");
    const greeting = await this.readLine();
    if (!greeting.startsWith("+OK")) {
      throw new Error(`pop3: greeting invalido: ${greeting}`);
    }
  }

  async close(): Promise<void> {
    const socket = this.socket;
    if (!socket) {
      return;
    }
    if (!socket.destroyed) {
      socket.end();
    }
    this.socket = null;
  }

  async command(command: string, multiline: boolean): Promise<Pop3CommandResult> {
    const socket = this.requireSocket();
    socket.write(`${command}\r\n`);
    const statusLine = await this.readLine();
    if (!statusLine.startsWith("+OK")) {
      return {
        ok: false,
        statusLine,
        lines: [],
      };
    }
    if (!multiline) {
      return {
        ok: true,
        statusLine,
        lines: [],
      };
    }
    const lines: string[] = [];
    while (true) {
      const line = await this.readLine();
      if (line === ".") {
        break;
      }
      lines.push(line.startsWith("..") ? line.slice(1) : line);
    }
    return {
      ok: true,
      statusLine,
      lines,
    };
  }

  private requireSocket(): tls.TLSSocket {
    if (!this.socket) {
      throw new Error("pop3: socket nao conectado");
    }
    return this.socket;
  }

  private async readLine(): Promise<string> {
    while (true) {
      const lineBreak = this.buffer.indexOf("\r\n");
      if (lineBreak >= 0) {
        const line = this.buffer.slice(0, lineBreak);
        this.buffer = this.buffer.slice(lineBreak + 2);
        return line;
      }
      const chunk = await this.readChunk();
      this.buffer += chunk;
    }
  }

  private async readChunk(): Promise<string> {
    const socket = this.requireSocket();
    const chunk = socket.read();
    if (typeof chunk === "string" && chunk.length > 0) {
      return chunk;
    }
    return new Promise<string>((resolve, reject) => {
      const onReadable = (): void => {
        cleanup();
        const next = socket.read();
        if (typeof next === "string") {
          resolve(next);
          return;
        }
        resolve("");
      };
      const onTimeout = (): void => {
        cleanup();
        reject(new Error("pop3: timeout aguardando resposta"));
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const onClose = (): void => {
        cleanup();
        reject(new Error("pop3: conexao encerrada"));
      };
      const cleanup = (): void => {
        socket.off("readable", onReadable);
        socket.off("timeout", onTimeout);
        socket.off("error", onError);
        socket.off("close", onClose);
      };
      socket.on("readable", onReadable);
      socket.on("timeout", onTimeout);
      socket.on("error", onError);
      socket.on("close", onClose);
    });
  }
}

function onceEvent(
  emitter: NodeJS.EventEmitter,
  event: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onEvent = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      emitter.off(event, onEvent);
      emitter.off("error", onError);
    };
    emitter.on(event, onEvent);
    emitter.on("error", onError);
  });
}
