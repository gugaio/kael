import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ShellToolService } from "./shell-tool-service.js";

const tempDirs: string[] = [];

async function createService(overrides?: {
  ask?: "off" | "on-miss" | "always";
  security?: "deny" | "allowlist" | "full";
  allowlist?: string[];
  approvalWaitMs?: number;
}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-shell-service-"));
  tempDirs.push(root);

  const service = new ShellToolService({
    workspaceRoot: root,
    defaultTimeoutMs: 5_000,
    maxTimeoutMs: 20_000,
    maxOutputChars: 20_000,
    approvalWaitMs: overrides?.approvalWaitMs ?? 4_000,
    security: overrides?.security ?? "allowlist",
    ask: overrides?.ask ?? "on-miss",
    allowlist: overrides?.allowlist ?? ["ls", "cat"],
    approvalsPath: path.join(root, "exec-approvals.json"),
  });
  await service.init();

  return { root, service };
}

async function waitForPendingApproval(
  service: ShellToolService,
  timeoutMs = 2000,
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const open = await service.listApprovals({ status: "open", limit: 20 });
    if (open.length > 0) {
      return open[0].id;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  throw new Error("approval not created in time");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("ShellToolService", () => {
  it("executa comando approved apos aprovacao manual", async () => {
    const { service } = await createService({ ask: "on-miss", allowlist: ["ls"] });

    const execPromise = service.exec({
      sessionKey: "s1",
      command: "echo approved-flow",
      background: false,
    });

    const approvalId = await waitForPendingApproval(service);
    const resolved = await service.resolveApproval(approvalId, "approved");
    expect(resolved?.status).toBe("approved");

    const result = await execPromise;
    expect(result.status).toBe("completed");
    expect(result.outputTail).toContain("approved-flow");
  });

  it("retorna denied quando aprovacao manual e negada", async () => {
    const { service } = await createService({ ask: "on-miss", allowlist: ["ls"] });

    const execPromise = service.exec({
      sessionKey: "s1",
      command: "echo should-not-run",
      background: false,
    });

    const approvalId = await waitForPendingApproval(service);
    await service.resolveApproval(approvalId, "denied");

    const result = await execPromise;
    expect(result.status).toBe("denied");
    expect(result.outputTail).toContain("negado");
  });
});
