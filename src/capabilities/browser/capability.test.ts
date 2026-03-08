import { describe, expect, it, vi } from "vitest";
import { BROWSER_ACTIONS, BrowserCapability } from "./capability.js";
import type { BrowserRuntime } from "./service.js";

describe("BrowserCapability", () => {
  it("delega acao para o runtime com action + params", async () => {
    const command = vi.fn(async () => ({
      ok: true,
      action: BROWSER_ACTIONS.open,
      status: "navigated" as const,
      message: "ok",
    }));
    const telemetry = {
      enabled: true,
      commands: 1,
      failures: 0,
      sessionsStarted: 0,
      sessionsClosed: 0,
      expiredSessionsClosed: 0,
      evictedSessions: 0,
      activeSessions: 0,
      actionCalls: {
        start: 0,
        open: 1,
        navigate: 0,
        snapshot_text: 0,
        screenshot: 0,
        click: 0,
        type: 0,
        press: 0,
        wait_for: 0,
        close: 0,
      },
      actionFailures: {
        start: 0,
        open: 0,
        navigate: 0,
        snapshot_text: 0,
        screenshot: 0,
        click: 0,
        type: 0,
        press: 0,
        wait_for: 0,
        close: 0,
      },
      avgLatencyMsByAction: {
        start: 0,
        open: 1,
        navigate: 0,
        snapshot_text: 0,
        screenshot: 0,
        click: 0,
        type: 0,
        press: 0,
        wait_for: 0,
        close: 0,
      },
    };
    const runtime: BrowserRuntime = {
      command,
      getRuntimeTelemetrySnapshot: () => telemetry,
    };
    const capability = new BrowserCapability(runtime);

    const result = await capability.executeAction(BROWSER_ACTIONS.open, {
      sessionKey: "s1",
      url: "https://example.com",
    });

    expect(capability.name).toBe("browser");
    expect(command).toHaveBeenCalledWith({
      sessionKey: "s1",
      action: BROWSER_ACTIONS.open,
      url: "https://example.com",
    });
    expect(result.ok).toBe(true);
    expect(capability.getRuntimeTelemetrySnapshot()).toEqual(telemetry);
  });
});
