import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ShellToolService } from "./service.js";

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
    noOutputTimeoutMs: 5_000,
    maxTimeoutMs: 20_000,
    maxOutputChars: 20_000,
    approvalWaitMs: overrides?.approvalWaitMs ?? 4_000,
    killGraceMs: 100,
    defaultYieldMs: 0,
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

  it("nao ressuscita sessao apos remove de processo em execucao", async () => {
    const { service } = await createService({
      ask: "off",
      security: "full",
    });

    const started = await service.exec({
      sessionKey: "s1",
      command: "sleep 1",
      background: true,
    });
    expect(started.status).toBe("running");

    const removed = await service.process({
      sessionKey: "s1",
      action: "remove",
      sessionId: started.id,
    });
    expect(removed.ok).toBe(true);

    const pollAfterRemove = await service.process({
      sessionKey: "s1",
      action: "poll",
      sessionId: started.id,
    });
    expect(pollAfterRemove.ok).toBe(false);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1300);
    });

    const pollAfterClose = await service.process({
      sessionKey: "s1",
      action: "poll",
      sessionId: started.id,
    });
    expect(pollAfterClose.ok).toBe(false);
  });

  it("yieldMs: retorna running quando o comando ultrapassa a janela", async () => {
    const { service } = await createService({ ask: "off", security: "full" });

    const session = await service.exec({
      sessionKey: "s1",
      command: "sleep 5",
      yieldMs: 80,
    });

    // O yield deve ter disparado antes do sleep terminar
    expect(session.status).toBe("running");
    expect(session.id).toBeTruthy();

    // Limpa — mata o processo antes de encerrar o teste
    await service.process({ sessionKey: "s1", action: "kill", sessionId: session.id });
  });

  it("yieldMs: retorna completed quando o comando termina antes da janela", async () => {
    const { service } = await createService({ ask: "off", security: "full" });

    const session = await service.exec({
      sessionKey: "s1",
      command: "echo done",
      yieldMs: 3_000,
    });

    expect(session.status).toBe("completed");
    expect(session.outputTail).toContain("done");
  });

  it("process write: envia dados ao stdin de processo em execucao", async () => {
    const { service } = await createService({ ask: "off", security: "full" });

    // Lê uma linha do stdin e faz echo
    const started = await service.exec({
      sessionKey: "s1",
      command: "read line && echo received:$line",
      background: true,
    });
    expect(started.status).toBe("running");

    const writeResult = await service.process({
      sessionKey: "s1",
      action: "write",
      sessionId: started.id,
      data: "hello\n",
      eof: true,
    });
    expect(writeResult.ok).toBe(true);

    // Aguarda o processo concluir após receber o input
    const completion = await new Promise<import("./service.js").ExecSession>((resolve) => {
      const check = async () => {
        const poll = await service.process({ sessionKey: "s1", action: "poll", sessionId: started.id });
        if (poll.session && poll.session.status !== "running") {
          resolve(poll.session);
          return;
        }
        setTimeout(check, 100);
      };
      void check();
    });

    expect(completion.status).toBe("completed");
    expect(completion.outputTail).toContain("received:hello");
  });
});
