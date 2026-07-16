import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { McpBridgeService } from "./mcp-bridge-service.js";
import type { ProcessRunner } from "../../process/runner.js";

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
      return { process: child as never };
    },
  };
}

const tempDirs: string[] = [];

async function createService(
  handler: (command: string, args: string[], child: FakeChildProcess) => void,
  overrides?: {
    allowHttp?: boolean;
    allowStdio?: boolean;
  },
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-mcp-bridge-"));
  tempDirs.push(root);
  const service = new McpBridgeService(
    {
      enabled: true,
      binary: "mcporter",
      configPath: path.join(root, "mcporter.json"),
      registryPath: path.join(root, "registry.json"),
      approvalsPath: path.join(root, "approvals.json"),
      workspaceRoot: root,
      defaultTimeoutMs: 2000,
      maxOutputChars: 10000,
      allowHttp: overrides?.allowHttp ?? false,
      allowStdio: overrides?.allowStdio ?? false,
    },
    createRunner(handler),
  );
  await service.init();
  return service;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("McpBridgeService", () => {
  it("lista registry local quando mcp_list e chamado sem servidor", async () => {
    const service = await createService(() => {
      throw new Error("runner should not be called");
    });
    await service.upsertServer({
      name: "linear",
      transport: "config",
      target: "linear",
      requireApproval: false,
    });

    const result = await service.list({ sessionKey: "s1" });
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([
      expect.objectContaining({
        name: "linear",
        transport: "config",
      }),
    ]);
  });

  it("cria approval pendente para servidor http registrado", async () => {
    const service = await createService(() => {
      throw new Error("runner should not be called");
    }, { allowHttp: true });
    await service.upsertServer({
      name: "custom-http",
      transport: "http",
      target: "https://example.com/mcp",
      requireApproval: true,
    });

    const result = await service.call({
      sessionKey: "s1",
      target: "custom-http.fetch",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("mcp_approval_required:");

    const approvals = await service.listApprovals({ status: "open" });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.serverName).toBe("custom-http");
  });

  it("executa mcp_call apos approval de servidor http", async () => {
    const service = await createService((_command, args, child) => {
      expect(args).toEqual([
        "call",
        "--config",
        expect.stringMatching(/mcporter\.json$/),
        "https://example.com/mcp.fetch",
        "--args",
        "{\"limit\":5}",
        "--output",
        "json",
      ]);
      child.stdout.end('{"items":[1,2]}');
      child.emit("close", 0);
    }, { allowHttp: true });
    await service.upsertServer({
      name: "custom-http",
      transport: "http",
      target: "https://example.com/mcp",
      requireApproval: true,
    });

    const first = await service.call({
      sessionKey: "s1",
      target: "custom-http.fetch",
      argumentsJson: "{\"limit\":5}",
    });
    expect(first.ok).toBe(false);

    const pending = await service.listApprovals({ status: "open" });
    await service.resolveApproval(pending[0]!.id, "approved");

    const second = await service.call({
      sessionKey: "s1",
      target: "custom-http.fetch",
      argumentsJson: "{\"limit\":5}",
    });
    expect(second.ok).toBe(true);
    expect(second.output).toEqual({ items: [1, 2] });
  });

  it("executa mcp_list com servidor stdio registrado e aprovado", async () => {
    const service = await createService((_command, args, child) => {
      expect(args).toEqual([
        "list",
        "--stdio",
        "bun run ./server.ts",
        "--config",
        expect.stringMatching(/mcporter\.json$/),
        "--schema",
        "--output",
        "json",
      ]);
      child.stdout.end('[{"name":"scrape"}]');
      child.emit("close", 0);
    }, { allowStdio: true });
    await service.upsertServer({
      name: "custom-stdio",
      transport: "stdio",
      target: "bun run ./server.ts",
      requireApproval: false,
    });

    const result = await service.list({
      sessionKey: "s1",
      server: "custom-stdio",
      schema: true,
    });
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([{ name: "scrape" }]);
  });

  it("retorna telemetria de registry e approvals", async () => {
    const service = await createService(() => {
      throw new Error("runner should not be called");
    }, { allowHttp: true });
    await service.upsertServer({
      name: "custom-http",
      transport: "http",
      target: "https://example.com/mcp",
      requireApproval: true,
    });

    await service.call({
      sessionKey: "s1",
      target: "custom-http.fetch",
    });

    const telemetry = service.getRuntimeTelemetrySnapshot();
    expect(telemetry.configuredServers).toBe(1);
    expect(telemetry.serversByTransport.http).toBe(1);
    expect(telemetry.approvalsOpen).toBe(1);
    expect(telemetry.blockedCalls).toBe(1);
  });
});
