import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceInspector } from "./inspector.js";

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "kael-workspace-inspector-"));
}

describe("WorkspaceInspector", () => {
  it("searches and reads workspace files", async () => {
    const root = await makeTmpDir();
    try {
      await fs.mkdir(path.join(root, "docs"), { recursive: true });
      await fs.writeFile(path.join(root, "docs", "info.md"), "Kael uses pi-agent-core\nand Fastify.\n", "utf-8");
      const inspector = new WorkspaceInspector({ workspaceRoot: root });

      const hits = await inspector.search({ query: "pi-agent-core" });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].path).toBe("docs/info.md");

      const read = await inspector.read({ relPath: "docs/info.md", from: 1, lines: 1 });
      expect(read.text).toContain("Kael uses pi-agent-core");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("blocks path outside workspace", async () => {
    const root = await makeTmpDir();
    try {
      const inspector = new WorkspaceInspector({ workspaceRoot: root });
      await expect(inspector.read({ relPath: "../etc/passwd" })).rejects.toThrow(/outside workspace/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

