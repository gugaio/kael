import { describe, expect, it } from "vitest";
import { BrowserToolService } from "./service.js";

describe("BrowserToolService", () => {
  it("retorna disabled quando browser runtime esta desabilitado", async () => {
    const service = new BrowserToolService({
      enabled: false,
      headless: true,
      defaultTimeoutMs: 30_000,
      actionTimeoutMs: 12_000,
      maxScreenshotsPerTurn: 3,
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

  it("retorna not_implemented quando habilitado na fase 16.0", async () => {
    const service = new BrowserToolService({
      enabled: true,
      headless: true,
      defaultTimeoutMs: 30_000,
      actionTimeoutMs: 12_000,
      maxScreenshotsPerTurn: 3,
      artifactDir: "/tmp/kael-browser-artifacts",
    });

    const result = await service.command({
      sessionKey: "s1",
      action: "start",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("not_implemented");
    const telemetry = service.getRuntimeTelemetrySnapshot();
    expect(telemetry.commands).toBe(1);
    expect(telemetry.failures).toBe(1);
    expect(telemetry.enabled).toBe(true);
  });
});
