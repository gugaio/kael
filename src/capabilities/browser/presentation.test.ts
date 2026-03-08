import { describe, expect, it } from "vitest";
import { BROWSER_ACTIONS } from "./capability.js";
import { formatBrowserReplyText, formatBrowserToolText, isBrowserInteractionAction } from "./presentation.js";

describe("browser/presentation", () => {
  it("detecta acoes de interacao", () => {
    expect(isBrowserInteractionAction(BROWSER_ACTIONS.click)).toBe(true);
    expect(isBrowserInteractionAction(BROWSER_ACTIONS.waitFor)).toBe(true);
    expect(isBrowserInteractionAction(BROWSER_ACTIONS.open)).toBe(false);
  });

  it("formata resposta de browser para tool/reply", () => {
    const result = {
      ok: true,
      action: BROWSER_ACTIONS.open,
      status: "navigated" as const,
      message: "ok",
      url: "https://example.com",
      textPreview: "hello world",
    };
    expect(formatBrowserToolText(result)).toContain("status=navigated");
    expect(formatBrowserReplyText(result)).toContain("browser action=open status=navigated");
  });
});

