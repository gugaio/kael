type CronField = {
  any: boolean;
  step?: number;
  exact?: number;
};

type ParsedCron = {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
};

function parseField(raw: string, min: number, max: number): CronField {
  const value = raw.trim();
  if (value === "*") {
    return { any: true };
  }

  if (value.startsWith("*/")) {
    const step = Number(value.slice(2));
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`invalid cron step: ${value}`);
    }
    return { any: false, step };
  }

  const exact = Number(value);
  if (!Number.isInteger(exact) || exact < min || exact > max) {
    throw new Error(`invalid cron value: ${value}`);
  }
  return { any: false, exact };
}

function matchesField(value: number, field: CronField): boolean {
  if (field.any) {
    return true;
  }
  if (typeof field.exact === "number") {
    return value === field.exact;
  }
  if (typeof field.step === "number") {
    return value % field.step === 0;
  }
  return false;
}

export function parseCronExpression(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("cron expression must have 5 fields");
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

function matches(date: Date, parsed: ParsedCron): boolean {
  return (
    matchesField(date.getMinutes(), parsed.minute) &&
    matchesField(date.getHours(), parsed.hour) &&
    matchesField(date.getDate(), parsed.dayOfMonth) &&
    matchesField(date.getMonth() + 1, parsed.month) &&
    matchesField(date.getDay(), parsed.dayOfWeek)
  );
}

export function computeNextCronRun(expr: string, from: Date): Date {
  const parsed = parseCronExpression(expr);
  const start = new Date(from.getTime());
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  // Busca limitada a 366 dias para evitar loop infinito em expressão inválida.
  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    if (matches(start, parsed)) {
      return start;
    }
    start.setMinutes(start.getMinutes() + 1);
  }

  throw new Error(`could not resolve next cron run for expression: ${expr}`);
}
