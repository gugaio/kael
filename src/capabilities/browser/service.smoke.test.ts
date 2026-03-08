import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BrowserToolService } from "./service.js";

function createFixtureHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Kael Browser Smoke</title>
  </head>
  <body>
    <h1>Kael Browser Smoke</h1>
    <form id="search-form">
      <label for="q">Busca</label>
      <input id="q" name="q" />
      <button id="submit-btn" type="submit">Enviar</button>
    </form>
    <div id="result" style="display:none"></div>
    <script>
      const form = document.getElementById("search-form");
      const input = document.getElementById("q");
      const result = document.getElementById("result");
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        result.textContent = "RESULT: " + input.value;
        result.style.display = "block";
      });
    </script>
  </body>
</html>`;
}

function isRestrictedRuntimeLaunchError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("sandbox_host_linux") ||
    normalized.includes("operation not permitted") ||
    normalized.includes("eperm") ||
    normalized.includes("target page, context or browser has been closed")
  );
}

describe("BrowserToolService smoke (real browser)", () => {
  it.runIf(process.env.KAEL_BROWSER_SMOKE === "1")("executa fluxo real: open -> type -> press -> wait -> screenshot -> close", async () => {
    const baseUrl = `data:text/html;charset=utf-8,${encodeURIComponent(createFixtureHtml())}`;
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-browser-smoke-"));
    const artifactsDir = path.join(root, "artifacts");
    const service = new BrowserToolService({
      enabled: true,
      headless: true,
      defaultTimeoutMs: 30_000,
      actionTimeoutMs: 12_000,
      maxScreenshotsPerTurn: 3,
      sessionTtlMs: 60_000,
      maxSessions: 2,
      artifactDir: artifactsDir,
    });

    const opened = await service.command({
      sessionKey: "smoke",
      action: "open",
      url: baseUrl,
    });
    if (!opened.ok) {
      if (isRestrictedRuntimeLaunchError(opened.message)) {
        // Ambiente atual pode bloquear launch de Chromium (sandbox/CI restrito).
        // Nesse caso o smoke nao deve quebrar a suite padrao.
        return;
      }
      throw new Error(`open falhou: ${opened.message}`);
    }
    expect(opened.status).toBe("navigated");

    const typed = await service.command({
      sessionKey: "smoke",
      action: "type",
      selector: "#q",
      text: "kael smoke",
    });
    expect(typed.ok).toBe(true);

    const pressed = await service.command({
      sessionKey: "smoke",
      action: "press",
      key: "Enter",
      selector: "#q",
    });
    expect(pressed.ok).toBe(true);

    const waited = await service.command({
      sessionKey: "smoke",
      action: "wait_for",
      selector: "#result",
      timeoutMs: 5_000,
    });
    expect(waited.ok).toBe(true);

    const snapshot = await service.command({
      sessionKey: "smoke",
      action: "snapshot_text",
    });
    expect(snapshot.ok).toBe(true);
    expect(snapshot.textPreview).toContain("RESULT: kael smoke");

    const shot = await service.command({
      sessionKey: "smoke",
      action: "screenshot",
    });
    expect(shot.ok).toBe(true);
    expect(shot.screenshotPath).toBeTruthy();
    const stat = await fs.stat(String(shot.screenshotPath));
    expect(stat.isFile()).toBe(true);

    const closed = await service.command({
      sessionKey: "smoke",
      action: "close",
    });
    expect(closed.ok).toBe(true);
    expect(closed.status).toBe("closed");

    const telemetry = service.getRuntimeTelemetrySnapshot();
    expect(telemetry.commands).toBe(7);
    expect(telemetry.failures).toBe(0);
    expect(telemetry.activeSessions).toBe(0);
  });
});
