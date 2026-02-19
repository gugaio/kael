import { describe, expect, it } from "vitest";
import { computeNextCronRun, parseCronExpression } from "./cron.js";

describe("cron", () => {
  it("deve parsear expressao valida com step", () => {
    expect(() => parseCronExpression("*/5 * * * *")).not.toThrow();
  });

  it("deve falhar em expressao invalida", () => {
    expect(() => parseCronExpression("invalid")).toThrow();
    expect(() => parseCronExpression("61 * * * *")).toThrow();
  });

  it("deve calcular proximo minuto para * * * * *", () => {
    const from = new Date("2026-02-19T10:10:40.000Z");
    const next = computeNextCronRun("* * * * *", from);
    expect(next.toISOString()).toBe("2026-02-19T10:11:00.000Z");
  });

  it("deve calcular proximo horario para expressao com hora/minuto exatos", () => {
    const from = new Date("2026-02-19T10:10:00.000Z");
    const next = computeNextCronRun("15 11 * * *", from);
    expect(next.getHours()).toBe(11);
    expect(next.getMinutes()).toBe(15);
  });
});
