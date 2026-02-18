import path from "node:path";

export type KaelConfig = {
  port: number;
  host: string;
  dataDir: string;
};

export function loadConfig(cwd = process.cwd()): KaelConfig {
  const envPort = Number(process.env.KAEL_PORT ?? "3210");
  const port = Number.isFinite(envPort) && envPort > 0 ? envPort : 3210;

  const host = process.env.KAEL_HOST?.trim() || "127.0.0.1";
  const dataDir = process.env.KAEL_DATA_DIR?.trim() || path.join(cwd, ".kael-data");

  return { port, host, dataDir };
}
