import { describe, expect, it } from "vitest";
import { buildPrompt, extractAssistantTextFromSdkMessage } from "./pi-engine-adapter.js";

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

describe("buildPrompt", () => {
  it("injeta fluxo de recall de memoria para pergunta pessoal sem contexto", () => {
    const prompt = buildPrompt({
      sessionKey: "s1",
      message: "Qual e meu time?",
      runtime: {} as never,
      contextMessages: [],
    });

    expect(prompt).toContain("Pergunta com alta chance de depender de memoria detectada.");
    expect(prompt).toContain("memory_search");
    expect(prompt).toContain("memory_get");
    expect(prompt).toContain("Mensagem atual do usuario:");
  });

  it("injeta fluxo de recall de memoria para pergunta pessoal com contexto", () => {
    const prompt = buildPrompt({
      sessionKey: "s1",
      message: "Lembra qual e minha preferencia de time?",
      runtime: {} as never,
      contextMessages: [{ role: "user", content: "oi", createdAt: "2026-03-03T00:00:00.000Z" }],
    });

    expect(prompt).toContain("Contexto recente da conversa");
    expect(prompt).toContain("Pergunta com alta chance de depender de memoria detectada.");
    expect(prompt).toContain("Consulta sugerida para memory_search");
  });

  it("injeta disciplina de pesquisa web para evitar cadeia de searches", () => {
    const prompt = buildPrompt({
      sessionKey: "s1",
      message: "Me traga os destaques de hoje do site infomoney.com.br",
      runtime: {} as never,
      contextMessages: [],
    });

    expect(prompt).toContain("Disciplina obrigatoria para pesquisa web:");
    expect(prompt).toContain("prefira web_research");
    expect(prompt).toContain("Se qualquer tool retornar blocked=true");
  });
});
