import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { LocalProcessRunner, type ProcessRunner } from "../system/process-runner.js";
import { kaelLogger } from "../../infra/logger.js";

type McpBridgeConfig = {
  enabled: boolean;
  binary: string;
  configPath?: string;
  workspaceRoot: string;
  defaultTimeoutMs: number;
  maxOutputChars: number;
  allowHttp: boolean;
  allowStdio: boolean;
};

type McpListParams = {
  sessionKey: string;
  server?: string;
  schema?: boolean;
  timeoutMs?: number;
};

type McpCallParams = {
  sessionKey: string;
  target: string;
  argumentsJson?: string;
  stdioCommand?: string;
  timeoutMs?: number;
};

export type McpListResult = {
  ok: boolean;
  command: string;
  server?: string;
  schema: boolean;
  format: "json";
  items?: unknown;
  output?: string;
  error?: string;
};

export type McpCallResult = {
  ok: boolean;
  command: string;
  target: string;
  format: "json";
  output?: unknown;
  rawOutput?: string;
  error?: string;
};

export interface McpRuntime {
  list(params: McpListParams): Promise<McpListResult>;
  call(params: McpCallParams): Promise<McpCallResult>;
}

type CommandRunResult = {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
};

function appendWithCap(current: string, chunk: string, maxChars: number): string {
  if (!chunk) {
    return current;
  }
  const next = current + chunk;
  if (next.length <= maxChars) {
    return next;
  }
  return next.slice(next.length - maxChars);
}

function parseJsonSafely(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  return JSON.parse(trimmed);
}

function isHttpTarget(target: string): boolean {
  return /^https?:\/\//i.test(target.trim());
}

export class McpBridgeService implements McpRuntime {
  private readonly runner: ProcessRunner;

  constructor(
    private readonly cfg: McpBridgeConfig,
    runner?: ProcessRunner,
  ) {
    this.runner = runner ?? new LocalProcessRunner();
  }

  async list(params: McpListParams): Promise<McpListResult> {
    if (!this.cfg.enabled) {
      return {
        ok: false,
        command: "",
        schema: Boolean(params.schema),
        format: "json",
        error: "mcp_disabled",
      };
    }

    const args = ["list"];
    if (params.server?.trim()) {
      args.push(params.server.trim());
    }
    if (params.schema) {
      args.push("--schema");
    }
    if (this.cfg.configPath) {
      args.push("--config", this.cfg.configPath);
    }
    args.push("--output", "json");

    const result = await this.runCommand(args, params.timeoutMs);
    if (!result.ok) {
      return {
        ok: false,
        command: result.command,
        server: params.server?.trim(),
        schema: Boolean(params.schema),
        format: "json",
        output: result.stdout.trim() || undefined,
        error: result.error || result.stderr.trim() || `mcporter exited with code ${result.exitCode ?? "unknown"}`,
      };
    }

    try {
      return {
        ok: true,
        command: result.command,
        server: params.server?.trim(),
        schema: Boolean(params.schema),
        format: "json",
        items: parseJsonSafely(result.stdout),
        output: result.stdout.trim() || undefined,
      };
    } catch (error) {
      return {
        ok: false,
        command: result.command,
        server: params.server?.trim(),
        schema: Boolean(params.schema),
        format: "json",
        output: result.stdout.trim() || undefined,
        error: `mcp_invalid_json: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async call(params: McpCallParams): Promise<McpCallResult> {
    if (!this.cfg.enabled) {
      return {
        ok: false,
        command: "",
        target: params.target,
        format: "json",
        error: "mcp_disabled",
      };
    }

    const target = params.target.trim();
    if (!target) {
      return {
        ok: false,
        command: "",
        target,
        format: "json",
        error: "mcp_target_required",
      };
    }
    if (isHttpTarget(target) && !this.cfg.allowHttp) {
      return {
        ok: false,
        command: "",
        target,
        format: "json",
        error: "mcp_http_disabled",
      };
    }
    if (params.stdioCommand?.trim() && !this.cfg.allowStdio) {
      return {
        ok: false,
        command: "",
        target,
        format: "json",
        error: "mcp_stdio_disabled",
      };
    }
    if (params.argumentsJson?.trim()) {
      try {
        parseJsonSafely(params.argumentsJson);
      } catch (error) {
        return {
          ok: false,
          command: "",
          target,
          format: "json",
          error: `mcp_args_invalid_json: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    const args = ["call"];
    if (params.stdioCommand?.trim()) {
      args.push("--stdio", params.stdioCommand.trim());
    }
    if (this.cfg.configPath) {
      args.push("--config", this.cfg.configPath);
    }
    args.push(target);
    if (params.argumentsJson?.trim()) {
      args.push("--args", params.argumentsJson.trim());
    }
    args.push("--output", "json");

    const result = await this.runCommand(args, params.timeoutMs);
    if (!result.ok) {
      return {
        ok: false,
        command: result.command,
        target,
        format: "json",
        rawOutput: result.stdout.trim() || undefined,
        error: result.error || result.stderr.trim() || `mcporter exited with code ${result.exitCode ?? "unknown"}`,
      };
    }

    try {
      return {
        ok: true,
        command: result.command,
        target,
        format: "json",
        output: parseJsonSafely(result.stdout),
        rawOutput: result.stdout.trim() || undefined,
      };
    } catch (error) {
      return {
        ok: false,
        command: result.command,
        target,
        format: "json",
        rawOutput: result.stdout.trim() || undefined,
        error: `mcp_invalid_json: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async runCommand(args: string[], timeoutMs?: number): Promise<CommandRunResult> {
    const startedAt = Date.now();
    const timeout = Math.max(1, Math.floor(timeoutMs ?? this.cfg.defaultTimeoutMs));
    const child = this.runner.spawn(this.cfg.binary, args, {
      cwd: this.cfg.workspaceRoot,
    }).process as ChildProcessWithoutNullStreams;
    const command = [this.cfg.binary, ...args].join(" ");

    return await new Promise<CommandRunResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;

      const finish = (result: CommandRunResult) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        kaelLogger.info("mcp.bridge.command.finished", {
          command,
          ok: result.ok,
          exitCode: result.exitCode,
          timedOut,
          durationMs: Date.now() - startedAt,
        });
        resolve(result);
      };

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        finish({
          ok: false,
          command,
          stdout,
          stderr,
          exitCode: null,
          error: `mcp_timeout:${timeout}`,
        });
      }, timeout);

      child.stdout.on("data", (chunk) => {
        stdout = appendWithCap(stdout, String(chunk), this.cfg.maxOutputChars);
      });
      child.stderr.on("data", (chunk) => {
        stderr = appendWithCap(stderr, String(chunk), this.cfg.maxOutputChars);
      });
      child.on("error", (error) => {
        finish({
          ok: false,
          command,
          stdout,
          stderr,
          exitCode: null,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      child.on("close", (code) => {
        finish({
          ok: code === 0,
          command,
          stdout,
          stderr,
          exitCode: code,
        });
      });
    });
  }
}
