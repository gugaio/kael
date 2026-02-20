import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExecApprovalStore, extractCommandBins } from "./shell-approvals.js";

const tempDirs: string[] = [];

async function createStore(overrides?: {
  security?: "deny" | "allowlist" | "full";
  ask?: "off" | "on-miss" | "always";
  allowlist?: string[];
}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-shell-approvals-"));
  tempDirs.push(root);
  const filePath = path.join(root, "exec-approvals.json");
  const store = new ExecApprovalStore(filePath, {
    security: overrides?.security ?? "allowlist",
    ask: overrides?.ask ?? "on-miss",
    allowlist: overrides?.allowlist ?? ["ls", "cat"],
  });
  await store.init();
  return { store, filePath };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("extractCommandBins", () => {
  it("extrai bins de pipelines", () => {
    expect(extractCommandBins("ls -la | grep foo | cat")).toEqual(["ls", "grep", "cat"]);
  });

  it("normaliza path para basename", () => {
    expect(extractCommandBins("/usr/bin/ffmpeg -i in.mp4 out.mp4")).toEqual(["ffmpeg"]);
  });
});

describe("ExecApprovalStore", () => {
  it("permite comando em allowlist", async () => {
    const { store } = await createStore();
    const decision = await store.evaluateCommand({ command: "ls -la", cwd: "/tmp" });
    expect(decision).toBeNull();
  });

  it("nega comando fora da allowlist quando ask=off", async () => {
    const { store } = await createStore({ ask: "off" });
    const decision = await store.evaluateCommand({ command: "rm -rf /tmp/x", cwd: "/tmp" });
    expect(decision?.status).toBe("denied");
  });

  it("gera pendencia quando comando fora da allowlist e ask=on-miss", async () => {
    const { store, filePath } = await createStore({ ask: "on-miss" });
    const decision = await store.evaluateCommand({ command: "rm -rf /tmp/x", cwd: "/tmp" });
    expect(decision?.status).toBe("approval-pending");
    expect(decision?.approvalId).toBeTruthy();

    const persisted = JSON.parse(await fs.readFile(filePath, "utf-8")) as {
      pending: Array<{ id: string; command: string; status: string }>;
    };
    expect(persisted.pending.length).toBe(1);
    expect(persisted.pending[0].command).toContain("rm -rf");
    expect(persisted.pending[0].status).toBe("pending");
  });

  it("deny bloqueia tudo", async () => {
    const { store } = await createStore({ security: "deny", ask: "off" });
    const decision = await store.evaluateCommand({ command: "ls", cwd: "/tmp" });
    expect(decision?.status).toBe("denied");
  });

  it("full com ask=off permite qualquer comando", async () => {
    const { store } = await createStore({ security: "full", ask: "off" });
    const decision = await store.evaluateCommand({ command: "unknown_bin --x", cwd: "/tmp" });
    expect(decision).toBeNull();
  });

  it("bloqueia sintaxe shell avancada em allowlist quando ask=off", async () => {
    const { store } = await createStore({ security: "allowlist", ask: "off", allowlist: ["cat"] });
    const decision = await store.evaluateCommand({ command: "cat a.txt; cat b.txt", cwd: "/tmp" });
    expect(decision?.status).toBe("denied");
    expect(decision?.reason).toContain("nao e permitido");
  });

  it("permite pipeline simples quando bins estao na allowlist", async () => {
    const { store } = await createStore({
      security: "allowlist",
      ask: "off",
      allowlist: ["cat", "grep"],
    });
    const decision = await store.evaluateCommand({ command: "cat a.txt | grep foo", cwd: "/tmp" });
    expect(decision).toBeNull();
  });

  it("resolve aprovacao pendente como approved", async () => {
    const { store } = await createStore({ ask: "on-miss" });
    const decision = await store.evaluateCommand({ command: "rm -rf /tmp/x", cwd: "/tmp" });
    expect(decision?.status).toBe("approval-pending");
    const approvalId = decision?.approvalId;
    expect(approvalId).toBeTruthy();

    const resolved = await store.resolveApproval(approvalId ?? "", "approved");
    expect(resolved?.status).toBe("approved");

    const listed = await store.listApprovals({ status: "approved" });
    expect(listed.length).toBe(1);
    expect(listed[0].id).toBe(approvalId);
  });

  it("waitForDecision retorna denied quando aprovacao e negada", async () => {
    const { store } = await createStore({ ask: "on-miss" });
    const decision = await store.evaluateCommand({ command: "rm -rf /tmp/x", cwd: "/tmp" });
    expect(decision?.status).toBe("approval-pending");
    const approvalId = decision?.approvalId ?? "";

    const wait = store.waitForDecision(approvalId, { timeoutMs: 5000, pollMs: 50 });
    await store.resolveApproval(approvalId, "denied");
    const result = await wait;

    expect(result.status).toBe("denied");
  });
});
