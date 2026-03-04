import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserToolService } from "./service.js";

const playwrightMocks = vi.hoisted(() => {
  const locator = {
    click: vi.fn(async () => {}),
    fill: vi.fn(async () => {}),
    waitFor: vi.fn(async () => {}),
  };
  const page = {
    goto: vi.fn(async () => {}),
    url: vi.fn(() => "https://example.com/"),
    title: vi.fn(async () => "Example Domain"),
    evaluate: vi.fn(async () => "Example Domain This domain is for use in illustrative examples."),
    screenshot: vi.fn(async (opts: { path?: string }) => {
      if (opts.path) {
        await fs.writeFile(opts.path, "fake-png-data", "utf-8");
      }
    }),
    locator: vi.fn(() => locator),
    getByText: vi.fn(() => locator),
    getByRole: vi.fn(() => locator),
    getByLabel: vi.fn(() => locator),
    keyboard: {
      press: vi.fn(async () => {}),
    },
  };
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => {}),
  };
  return {
    chromium: {
      launch: vi.fn(async () => browser),
    },
    locator,
    page,
    context,
    browser,
  };
});

vi.mock("playwright", () => ({
  chromium: playwrightMocks.chromium,
}));

describe("BrowserToolService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna disabled quando browser runtime esta desabilitado", async () => {
    const service = new BrowserToolService({
      enabled: false,
      headless: true,
      defaultTimeoutMs: 30_000,
      actionTimeoutMs: 12_000,
      maxScreenshotsPerTurn: 3,
      sessionTtlMs: 60_000,
      maxSessions: 4,
      artifactDir: "/tmp/kael-browser-artifacts",
    });

    const result = await service.command({
      sessionKey: "s1",
      action: "open",
      url: "https://example.com",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("disabled");
    const telemetry = service.getRuntimeTelemetrySnapshot();
    expect(telemetry.commands).toBe(1);
    expect(telemetry.failures).toBe(1);
    expect(telemetry.enabled).toBe(false);
  });

  it("executa fluxo read-only com start/open/snapshot/screenshot/close", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-browser-test-"));
    const artifactsDir = path.join(root, "artifacts");
    const service = new BrowserToolService({
      enabled: true,
      headless: true,
      defaultTimeoutMs: 30_000,
      actionTimeoutMs: 12_000,
      maxScreenshotsPerTurn: 3,
      sessionTtlMs: 60_000,
      maxSessions: 4,
      artifactDir: artifactsDir,
    });

    const started = await service.command({
      sessionKey: "s1",
      action: "start",
    });
    expect(started.ok).toBe(true);
    expect(started.status).toBe("started");

    const opened = await service.command({
      sessionKey: "s1",
      action: "open",
      url: "https://example.com",
    });
    expect(opened.ok).toBe(true);
    expect(opened.status).toBe("navigated");

    const snapshot = await service.command({
      sessionKey: "s1",
      action: "snapshot_text",
    });
    expect(snapshot.ok).toBe(true);
    expect(snapshot.status).toBe("snapshotted");
    expect(snapshot.textPreview).toContain("Example Domain");

    const screenshot = await service.command({
      sessionKey: "s1",
      action: "screenshot",
    });
    expect(screenshot.ok).toBe(true);
    expect(screenshot.status).toBe("screenshot_saved");
    expect(screenshot.screenshotPath).toBeTruthy();
    const stat = await fs.stat(String(screenshot.screenshotPath));
    expect(stat.isFile()).toBe(true);

    const closed = await service.command({
      sessionKey: "s1",
      action: "close",
    });
    expect(closed.ok).toBe(true);
    expect(closed.status).toBe("closed");

    const telemetry = service.getRuntimeTelemetrySnapshot();
    expect(telemetry.commands).toBe(5);
    expect(telemetry.failures).toBe(0);
    expect(telemetry.sessionsStarted).toBe(1);
    expect(telemetry.sessionsClosed).toBe(1);
    expect(telemetry.activeSessions).toBe(0);
    expect(telemetry.enabled).toBe(true);
  });

  it("aplica limite de screenshots por sessao", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-browser-limit-"));
    const service = new BrowserToolService({
      enabled: true,
      headless: true,
      defaultTimeoutMs: 30_000,
      actionTimeoutMs: 12_000,
      maxScreenshotsPerTurn: 1,
      sessionTtlMs: 60_000,
      maxSessions: 4,
      artifactDir: path.join(root, "artifacts"),
    });

    await service.command({
      sessionKey: "s2",
      action: "start",
    });

    const first = await service.command({
      sessionKey: "s2",
      action: "screenshot",
    });
    const second = await service.command({
      sessionKey: "s2",
      action: "screenshot",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.message).toContain("limite de screenshots");
  });

  it("executa click/type/wait_for/press com seletores", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-browser-actions-"));
    const service = new BrowserToolService({
      enabled: true,
      headless: true,
      defaultTimeoutMs: 30_000,
      actionTimeoutMs: 12_000,
      maxScreenshotsPerTurn: 3,
      sessionTtlMs: 60_000,
      maxSessions: 4,
      artifactDir: path.join(root, "artifacts"),
    });

    await service.command({ sessionKey: "s3", action: "start" });

    const clickResult = await service.command({
      sessionKey: "s3",
      action: "click",
      selector: "text=Entrar",
    });
    const typeResult = await service.command({
      sessionKey: "s3",
      action: "type",
      selector: "label=Email",
      text: "user@example.com",
    });
    const waitResult = await service.command({
      sessionKey: "s3",
      action: "wait_for",
      selector: "role=button|Enviar",
    });
    const pressResult = await service.command({
      sessionKey: "s3",
      action: "press",
      key: "Enter",
      selector: "#search",
    });

    expect(clickResult.ok).toBe(true);
    expect(typeResult.ok).toBe(true);
    expect(waitResult.ok).toBe(true);
    expect(pressResult.ok).toBe(true);

    expect(playwrightMocks.page.getByText).toHaveBeenCalledWith("Entrar");
    expect(playwrightMocks.page.getByLabel).toHaveBeenCalledWith("Email");
    expect(playwrightMocks.page.getByRole).toHaveBeenCalledWith("button", { name: "Enviar" });
    expect(playwrightMocks.page.locator).toHaveBeenCalledWith("#search");
    expect(playwrightMocks.page.keyboard.press).toHaveBeenCalledWith("Enter");
    expect(playwrightMocks.locator.fill).toHaveBeenCalledWith(
      "user@example.com",
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(playwrightMocks.locator.waitFor).toHaveBeenCalledWith(
      expect.objectContaining({ state: "visible", timeout: expect.any(Number) }),
    );
  });

  it("fecha sessao expirada por TTL automaticamente", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-browser-ttl-"));
    const service = new BrowserToolService({
      enabled: true,
      headless: true,
      defaultTimeoutMs: 30_000,
      actionTimeoutMs: 12_000,
      maxScreenshotsPerTurn: 3,
      sessionTtlMs: 1,
      maxSessions: 4,
      artifactDir: path.join(root, "artifacts"),
    });

    await service.command({ sessionKey: "ttl-1", action: "start" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.command({ sessionKey: "ttl-1", action: "start" });

    const telemetry = service.getRuntimeTelemetrySnapshot();
    expect(telemetry.sessionsStarted).toBe(2);
    expect(telemetry.expiredSessionsClosed).toBe(1);
    expect(telemetry.activeSessions).toBe(1);
  });

  it("evicta sessao mais antiga quando excede maxSessions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-browser-evict-"));
    const service = new BrowserToolService({
      enabled: true,
      headless: true,
      defaultTimeoutMs: 30_000,
      actionTimeoutMs: 12_000,
      maxScreenshotsPerTurn: 3,
      sessionTtlMs: 60_000,
      maxSessions: 1,
      artifactDir: path.join(root, "artifacts"),
    });

    await service.command({ sessionKey: "evict-a", action: "start" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await service.command({ sessionKey: "evict-b", action: "start" });

    const telemetry = service.getRuntimeTelemetrySnapshot();
    expect(telemetry.sessionsStarted).toBe(2);
    expect(telemetry.evictedSessions).toBe(1);
    expect(telemetry.activeSessions).toBe(1);
  });
});
