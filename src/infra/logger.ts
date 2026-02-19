type LogLevel = "info" | "warn" | "error";

type LogPayload = Record<string, unknown>;

function emit(level: LogLevel, event: string, payload: LogPayload): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...payload,
  };
  console.log(JSON.stringify(entry));
}

export const kaelLogger = {
  info(event: string, payload: LogPayload = {}): void {
    emit("info", event, payload);
  },
  warn(event: string, payload: LogPayload = {}): void {
    emit("warn", event, payload);
  },
  error(event: string, payload: LogPayload = {}): void {
    emit("error", event, payload);
  },
};

