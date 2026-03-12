import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { McpBridgeService } from "./mcp-bridge-service.js";
import type { ProcessRunner } from "../system/process-runner.js";

class FakeChildProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    this.emit("close", null);
    return true;
  }
}

function createRunner(
  handler: (command: string, args: string[], child: FakeChildProcess) => void,
): ProcessRunner {
  return {
    spawn(command, args) {
      const child = new FakeChildProcess();
      queueMicrotask(() => {
        handler(command, args, child);
      });
      return {
        process: child as never,
      };
    },
  };
}

describe("McpBridgeService", () => {
  it("lista servidores e parseia saida json", async () => {
    const service = new McpBridgeService(
      {
        enabled: true,
        binary: "mcporter",
        workspaceRoot: "/tmp",
        defaultTimeoutMs: 2000,
        maxOutputChars: 10000,
        allowHttp: false,
        allowStdio: false,
      },
      createRunner((_command, args, child) => {
        expect(args).toEqual(["list", "--output", "json"]);
        child.stdout.end('[{"name":"linear"}]');
        child.emit("close", 0);
      }),
    );

    const result = await service.list({ sessionKey: "s1" });
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([{ name: "linear" }]);
  });

  it("bloqueia target http quando desabilitado", async () => {
    const service = new McpBridgeService(
      {
        enabled: true,
        binary: "mcporter",
        workspaceRoot: "/tmp",
        defaultTimeoutMs: 2000,
        maxOutputChars: 10000,
        allowHttp: false,
        allowStdio: false,
      },
      createRunner(() => {
        throw new Error("runner should not be called");
      }),
    );

    const result = await service.call({
      sessionKey: "s1",
      target: "https://example.com/mcp.fetch",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("mcp_http_disabled");
  });

  it("bloqueia stdio quando desabilitado", async () => {
    const service = new McpBridgeService(
      {
        enabled: true,
        binary: "mcporter",
        workspaceRoot: "/tmp",
        defaultTimeoutMs: 2000,
        maxOutputChars: 10000,
        allowHttp: true,
        allowStdio: false,
      },
      createRunner(() => {
        throw new Error("runner should not be called");
      }),
    );

    const result = await service.call({
      sessionKey: "s1",
      target: "scrape",
      stdioCommand: "bun run ./server.ts",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("mcp_stdio_disabled");
  });

  it("valida argumentsJson antes de executar", async () => {
    const service = new McpBridgeService(
      {
        enabled: true,
        binary: "mcporter",
        workspaceRoot: "/tmp",
        defaultTimeoutMs: 2000,
        maxOutputChars: 10000,
        allowHttp: true,
        allowStdio: true,
      },
      createRunner(() => {
        throw new Error("runner should not be called");
      }),
    );

    const result = await service.call({
      sessionKey: "s1",
      target: "linear.list_issues",
      argumentsJson: "{invalid",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("mcp_args_invalid_json");
  });

  it("executa mcp_call e parseia payload json", async () => {
    const service = new McpBridgeService(
      {
        enabled: true,
        binary: "mcporter",
        configPath: "/tmp/mcporter.json",
        workspaceRoot: "/tmp",
        defaultTimeoutMs: 2000,
        maxOutputChars: 10000,
        allowHttp: false,
        allowStdio: false,
      },
      createRunner((_command, args, child) => {
        expect(args).toEqual([
          "call",
          "--config",
          "/tmp/mcporter.json",
          "linear.list_issues",
          "--args",
          "{\"limit\":5}",
          "--output",
          "json",
        ]);
        child.stdout.end('{"issues":[{"id":"1"}]}');
        child.emit("close", 0);
      }),
    );

    const result = await service.call({
      sessionKey: "s1",
      target: "linear.list_issues",
      argumentsJson: "{\"limit\":5}",
    });
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ issues: [{ id: "1" }] });
  });
});
