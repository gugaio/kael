import Fastify from "fastify";
import { createKaelApp } from "../app.js";

export async function startApiServer(): Promise<void> {
  const app = await createKaelApp();
  const server = Fastify({ logger: true });

  server.get("/health", async () => ({
    ok: true,
    service: "kael",
    now: new Date().toISOString(),
    engineMode: app.config.engineMode,
    piEnabled: app.config.pi.enabled,
  }));

  server.post<{ Body: { sessionKey?: string; message?: string } }>("/chat", async (request, reply) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const message = request.body.message?.trim();

    if (!message) {
      return reply.code(400).send({ ok: false, error: "message is required" });
    }

    const result = await app.chat.handleMessage({ sessionKey, message });
    return {
      ok: true,
      sessionKey,
      reply: result.reply,
      user: result.user,
      assistant: result.assistant,
    };
  });

  server.get<{ Params: { sessionKey: string }; Querystring: { limit?: string } }>(
    "/sessions/:sessionKey/messages",
    async (request) => {
      const parsedLimit = Number(request.query.limit ?? "50");
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
      const messages = await app.chat.getHistory(request.params.sessionKey, limit);
      return { ok: true, messages };
    },
  );

  server.post<{
    Body: {
      sessionKey?: string;
      inputPath?: string;
      outputPath?: string;
      args?: string[];
    };
  }>("/jobs/transcode", async (request, reply) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const inputPath = request.body.inputPath?.trim();
    const outputPath = request.body.outputPath?.trim();

    if (!inputPath || !outputPath) {
      return reply.code(400).send({ ok: false, error: "inputPath and outputPath are required" });
    }

    const job = await app.jobs.startTranscode({
      sessionKey,
      inputPath,
      outputPath,
      args: request.body.args,
    });

    return { ok: true, job };
  });

  server.post<{
    Body: {
      sessionKey?: string;
      inputPath?: string;
      outputPlaylistPath?: string;
      segmentTime?: number;
    };
  }>("/jobs/hls", async (request, reply) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const inputPath = request.body.inputPath?.trim();
    const outputPlaylistPath = request.body.outputPlaylistPath?.trim();

    if (!inputPath || !outputPlaylistPath) {
      return reply.code(400).send({ ok: false, error: "inputPath and outputPlaylistPath are required" });
    }

    const job = await app.jobs.startConvertHls({
      sessionKey,
      inputPath,
      outputPlaylistPath,
      segmentTime: request.body.segmentTime,
    });

    return { ok: true, job };
  });

  server.post<{
    Body: {
      sessionKey?: string;
      streamUrl?: string;
      outputPath?: string;
      durationSeconds?: number;
    };
  }>("/jobs/capture", async (request, reply) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const streamUrl = request.body.streamUrl?.trim();
    const outputPath = request.body.outputPath?.trim();

    if (!streamUrl || !outputPath) {
      return reply.code(400).send({ ok: false, error: "streamUrl and outputPath are required" });
    }

    const job = await app.jobs.startCaptureStream({
      sessionKey,
      streamUrl,
      outputPath,
      durationSeconds: request.body.durationSeconds,
    });

    return { ok: true, job };
  });

  server.post<{
    Body: {
      sessionKey?: string;
      inputPath?: string;
    };
  }>("/jobs/probe", async (request, reply) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const inputPath = request.body.inputPath?.trim();

    if (!inputPath) {
      return reply.code(400).send({ ok: false, error: "inputPath is required" });
    }

    const job = await app.jobs.startProbeMedia({ sessionKey, inputPath });
    return { ok: true, job };
  });

  server.get("/jobs", async () => ({ ok: true, jobs: app.jobs.listJobs() }));

  server.get<{ Params: { jobId: string } }>("/jobs/:jobId", async (request, reply) => {
    const job = app.jobs.getJob(request.params.jobId);
    if (!job) {
      return reply.code(404).send({ ok: false, error: "job not found" });
    }
    return { ok: true, job };
  });

  server.get<{ Params: { jobId: string } }>("/jobs/:jobId/log", async (request, reply) => {
    const log = await app.jobs.getJobLog(request.params.jobId);
    if (log === null) {
      return reply.code(404).send({ ok: false, error: "job not found" });
    }
    return { ok: true, log };
  });

  await server.listen({ host: app.config.host, port: app.config.port });
}
