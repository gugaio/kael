import { describe, expect, it } from "vitest";
import { BROWSER_ACTIONS, BrowserRuntimeService, type BrowserRuntime } from "./index.js";

describe("browser runtime contracts", () => {
  it("expoe a lista de actions suportadas", () => {
    expect(BROWSER_ACTIONS.open).toBe("open");
    expect(BROWSER_ACTIONS.waitFor).toBe("wait_for");
  });

  it("mantem BrowserRuntimeService alinhado ao contrato BrowserRuntime", () => {
    const instance = Object.create(BrowserRuntimeService.prototype) as BrowserRuntime;
    expect(typeof instance.command).toBe("function");
    expect(typeof instance.getRuntimeTelemetrySnapshot).toBe("function");
  });
});
