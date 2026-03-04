export type BrowserCommandAction =
  | "start"
  | "open"
  | "navigate"
  | "snapshot_text"
  | "screenshot"
  | "click"
  | "type"
  | "press"
  | "wait_for"
  | "close";

export type BrowserCommandInput = {
  sessionKey: string;
  action: BrowserCommandAction;
  targetId?: string;
  url?: string;
  selector?: string;
  text?: string;
  key?: string;
  timeoutMs?: number;
};

export type BrowserCommandResult = {
  ok: boolean;
  action: BrowserCommandAction;
  status: "disabled" | "not_implemented";
  message: string;
};

export type BrowserRuntimeTelemetry = {
  enabled: boolean;
  commands: number;
  failures: number;
  sessionsStarted: number;
  sessionsClosed: number;
  activeSessions: number;
};

export interface BrowserRuntime {
  command(input: BrowserCommandInput): Promise<BrowserCommandResult>;
  getRuntimeTelemetrySnapshot(): BrowserRuntimeTelemetry;
}

export type BrowserToolConfig = {
  enabled: boolean;
  headless: boolean;
  defaultTimeoutMs: number;
  actionTimeoutMs: number;
  maxScreenshotsPerTurn: number;
  artifactDir: string;
};

export class BrowserToolService implements BrowserRuntime {
  private readonly telemetry: BrowserRuntimeTelemetry;

  constructor(private readonly cfg: BrowserToolConfig) {
    this.telemetry = {
      enabled: cfg.enabled,
      commands: 0,
      failures: 0,
      sessionsStarted: 0,
      sessionsClosed: 0,
      activeSessions: 0,
    };
  }

  getRuntimeTelemetrySnapshot(): BrowserRuntimeTelemetry {
    return { ...this.telemetry };
  }

  async command(input: BrowserCommandInput): Promise<BrowserCommandResult> {
    this.telemetry.commands += 1;
    if (!this.cfg.enabled) {
      this.telemetry.failures += 1;
      return {
        ok: false,
        action: input.action,
        status: "disabled",
        message: "browser runtime desabilitado (KAEL_BROWSER_ENABLED=false)",
      };
    }
    this.telemetry.failures += 1;
    return {
      ok: false,
      action: input.action,
      status: "not_implemented",
      message: "browser runtime habilitado, mas acao ainda nao implementada (fase 16.0)",
    };
  }
}
