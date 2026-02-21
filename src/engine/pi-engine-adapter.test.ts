import { describe, expect, it } from "vitest";
import { extractAssistantTextFromSdkMessage } from "./pi-engine-adapter.js";

describe("extractAssistantTextFromSdkMessage", () => {
  it("prefers assistant/output blocks and ignores input/tool blocks", () => {
    const text = extractAssistantTextFromSdkMessage({
      role: "assistant",
      content: [
        { type: "input_text", text: "Mensagem atual do usuario: Ola Kael" },
        { type: "tool_result", text: "fetched old football result" },
        { type: "output_text", text: "Ola! Tudo bem por aqui." },
      ],
    });

    expect(text).toBe("Ola! Tudo bem por aqui.");
  });

  it("falls back to direct string content", () => {
    const text = extractAssistantTextFromSdkMessage({
      role: "assistant",
      content: "Resposta direta",
    });

    expect(text).toBe("Resposta direta");
  });
});

