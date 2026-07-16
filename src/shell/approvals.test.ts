import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExecApprovalStore, detectObfuscation, extractCommandBins } from "./approvals.js";

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

  it("allowAlways: persiste bins na allowlist ao aprovar", async () => {
    const { store, filePath } = await createStore({ ask: "on-miss", allowlist: ["ls"] });
    const decision = await store.evaluateCommand({ command: "curl https://example.com", cwd: "/tmp" });
    expect(decision?.status).toBe("approval-pending");

    await store.resolveApproval(decision?.approvalId ?? "", "approved", { allowAlways: true });

    const persisted = JSON.parse(await fs.readFile(filePath, "utf-8")) as { allowlist: string[] };
    expect(persisted.allowlist).toContain("curl");
    expect(persisted.allowlist).toContain("ls"); // original preservado

    // Proximo comando com mesmo bin deve passar direto
    const next = await store.evaluateCommand({ command: "curl https://other.com", cwd: "/tmp" });
    expect(next).toBeNull();
  });

  it("allowAlways: deny nao afeta a allowlist", async () => {
    const { store, filePath } = await createStore({ ask: "on-miss", allowlist: ["ls"] });
    const decision = await store.evaluateCommand({ command: "curl https://example.com", cwd: "/tmp" });
    expect(decision?.status).toBe("approval-pending");

    await store.resolveApproval(decision?.approvalId ?? "", "denied", { allowAlways: true });

    const persisted = JSON.parse(await fs.readFile(filePath, "utf-8")) as { allowlist: string[] };
    expect(persisted.allowlist).not.toContain("curl");
  });
});

describe("detectObfuscation", () => {
  it("detecta base64 -d piped to shell", () => {
    expect(detectObfuscation("echo abc | base64 -d | bash")).not.toBeNull();
    expect(detectObfuscation("base64 --decode payload | sh")).not.toBeNull();
  });

  it("detecta eval como comando", () => {
    expect(detectObfuscation("eval $(cat /etc/passwd)")).not.toBeNull();
    expect(detectObfuscation("echo x | eval")).not.toBeNull();
  });

  it("detecta ofuscacao por aspas em binario shell", () => {
    expect(detectObfuscation('b"a"sh -c "cmd"')).not.toBeNull();
    expect(detectObfuscation("'bash' -c cmd")).not.toBeNull();
  });

  it("nao bloqueia comandos normais", () => {
    expect(detectObfuscation("ls -la")).toBeNull();
    expect(detectObfuscation("cat file.txt | grep foo")).toBeNull();
    expect(detectObfuscation("ffmpeg -i in.mp4 out.mp4")).toBeNull();
    expect(detectObfuscation("curl https://example.com")).toBeNull();
    expect(detectObfuscation('echo "hello world"')).toBeNull();
  });

  it("bloqueia via evaluateCommand independente de security level", async () => {
    const { store } = await createStore({ security: "full", ask: "off" });
    const decision = await store.evaluateCommand({
      command: "echo payload | base64 -d | bash",
      cwd: "/tmp",
    });
    expect(decision?.status).toBe("denied");
    expect(decision?.reason).toContain("base64");
  });
});
