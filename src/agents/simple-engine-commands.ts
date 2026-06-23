import { BROWSER_ACTIONS, formatBrowserReplyText } from "../runtime/browser/index.js";
import type { EngineToolingInterface, EngineTurnInput, EngineTurnOutput } from "./types.js";

type ParsedCommand = {
  name: string;
  args: string[];
};

function parseCommand(message: string): ParsedCommand | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  const [name, ...args] = parts;
  return { name: name.toLowerCase(), args };
}

export function isSlashCommand(message: string): boolean {
  return message.trim().startsWith("/");
}

function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/\S+/i);
  if (!match?.[0]) {
    return null;
  }
  return match[0].trim().replace(/[),.;]+$/, "");
}

function looksLikeYouboraBoundary(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const text = value.trim();
  return /^last\d+(hours|days)$/i.test(text) || /^\d{4}-\d{2}-\d{2}/.test(text);
}

function helpReply(): EngineTurnOutput {
  return {
    reply:
      "Comandos: /transcode <input> <output> | /hls <input> <playlist.m3u8> [segmentSeconds] | /capture <url> <output> [durationSeconds] | /probe <input> | /vlc <input|url> | /jobs | /youbora [metrics|rawdata|events] <fromDate> ... | /browser-start | /browser-open <url> | /browser-snapshot | /browser-shot | /browser-click <selector> | /browser-type <selector> <texto> | /browser-press <tecla> [selector] | /browser-wait <selector> [timeoutMs] | /browser-close | /help",
  };
}

function listJobsReply(tooling: EngineToolingInterface): EngineTurnOutput {
  const jobs = tooling.jobs.listJobs().slice(0, 8);
  if (jobs.length === 0) {
    return { reply: "Nenhum job encontrado." };
  }

  const summary = jobs
    .map(
      (job) =>
        `- ${job.id} | status=${job.status}${job.output ? ` | output=${job.output}` : ""}`,
    )
    .join("\n");

  return { reply: `Ultimos jobs:\n${summary}` };
}

function formatEdgeReply(result: {
  ok: boolean;
  capability: string;
  taskId: string;
  error?: string;
  output?: unknown;
}): EngineTurnOutput {
  return {
    reply: [
      `ok=${result.ok}`,
      `capability=${result.capability}`,
      `taskId=${result.taskId}`,
      result.error ? `error=${result.error}` : "",
      result.output !== undefined ? `output=${JSON.stringify(result.output)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

async function handleYouboraCommand(
  parsed: ParsedCommand,
  tooling: EngineToolingInterface,
): Promise<EngineTurnOutput> {
  const [firstArg, ...restArgs] = parsed.args;
  const mode = ["metrics", "rawdata", "events"].includes(firstArg ?? "") ? firstArg : "metrics";
  const args = mode === "metrics" && firstArg !== "metrics" && firstArg !== "rawdata" && firstArg !== "events"
    ? parsed.args
    : restArgs;

  if (args.length < 1) {
    return {
      reply:
        "Uso: /youbora [metrics|rawdata|events] <fromDate> [toDate] [metrics|type] [type|granularity|filtersJson] [granularity|filtersJson]",
    };
  }

  if (mode === "metrics") {
    const [fromDate, second, third, fourth, fifth] = args;
    const hasToDate = looksLikeYouboraBoundary(second);
    const result = await tooling.edge.youboraMetricsGet({
      fromDate,
      toDate: hasToDate ? second : undefined,
      metrics: hasToDate ? third : second,
      type: hasToDate ? fourth : third,
      granularity: hasToDate ? fifth : fourth,
    });
    return formatEdgeReply(result);
  }

  const [fromDate, second, third, ...rest] = args;
  const hasToDate = looksLikeYouboraBoundary(second);
  const filtersJson = (hasToDate ? rest : [third, ...rest]).filter(Boolean).join(" ").trim() || undefined;
  let filters: unknown = undefined;
  if (filtersJson) {
    try {
      filters = JSON.parse(filtersJson);
    } catch {
      return {
        reply: `filtersJson invalido: ${filtersJson}`,
      };
    }
  }

  const result = mode === "rawdata"
    ? await tooling.edge.youboraRawdataGet({
        fromDate,
        toDate: hasToDate ? second : undefined,
        type: hasToDate ? third : second,
        filters,
      })
    : await tooling.edge.youboraEventsGet({
        fromDate,
        toDate: hasToDate ? second : undefined,
        type: hasToDate ? third : second,
        filters,
      });
  return formatEdgeReply(result);
}

async function handleVideoJobCommand(
  input: EngineTurnInput,
  parsed: ParsedCommand,
  tooling: EngineToolingInterface,
): Promise<EngineTurnOutput | null> {
  if (parsed.name === "/transcode") {
    if (parsed.args.length < 2) {
      return { reply: "Uso: /transcode <input> <output>" };
    }

    const [inputPath, outputPath] = parsed.args;
    const job = await tooling.video.startTranscode({
      sessionKey: input.sessionKey,
      inputPath,
      outputPath,
    });
    return { reply: `Transcode iniciado. jobId=${job.id}` };
  }

  if (parsed.name === "/hls") {
    if (parsed.args.length < 2) {
      return { reply: "Uso: /hls <input> <playlist.m3u8> [segmentSeconds]" };
    }

    const [inputPath, outputPlaylistPath, segmentRaw] = parsed.args;
    const job = await tooling.video.startConvertHls({
      sessionKey: input.sessionKey,
      inputPath,
      outputPlaylistPath,
      segmentTime: segmentRaw ? Number(segmentRaw) : undefined,
    });
    return { reply: `HLS iniciado. jobId=${job.id}` };
  }

  if (parsed.name === "/capture") {
    if (parsed.args.length < 2) {
      return { reply: "Uso: /capture <streamUrl> <output> [durationSeconds]" };
    }

    const [streamUrl, outputPath, durationRaw] = parsed.args;
    const job = await tooling.video.startCaptureStream({
      sessionKey: input.sessionKey,
      streamUrl,
      outputPath,
      durationSeconds: durationRaw ? Number(durationRaw) : undefined,
    });
    return { reply: `Capture iniciado. jobId=${job.id}` };
  }

  if (parsed.name === "/probe") {
    if (parsed.args.length < 1) {
      return { reply: "Uso: /probe <input>" };
    }

    const [inputPath] = parsed.args;
    const job = await tooling.video.startProbeMedia({
      sessionKey: input.sessionKey,
      inputPath,
    });
    return { reply: `Probe iniciado. jobId=${job.id}` };
  }

  if (parsed.name === "/vlc" || parsed.name === "/playvlc") {
    const inputTarget = parsed.args[0] ?? extractUrl(input.message);
    if (!inputTarget) {
      return { reply: "Uso: /vlc <input|url>" };
    }
    if (!tooling.video.startPlayVlc) {
      return { reply: "Tool de VLC indisponivel neste modo." };
    }

    const job = await tooling.video.startPlayVlc({
      sessionKey: input.sessionKey,
      input: inputTarget,
    });
    return { reply: `VLC iniciado. jobId=${job.id}` };
  }

  return null;
}

function parseTimeout(timeoutRaw: string | undefined): number | undefined {
  const parsedTimeout = timeoutRaw ? Number(timeoutRaw) : undefined;
  if (parsedTimeout == null || !Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
    return undefined;
  }
  return Math.floor(parsedTimeout);
}

async function handleBrowserCommand(
  input: EngineTurnInput,
  parsed: ParsedCommand,
  tooling: EngineToolingInterface,
): Promise<EngineTurnOutput | null> {
  if (parsed.name === "/browser-start") {
    const result = await tooling.browser.browserCommand({
      sessionKey: input.sessionKey,
      action: BROWSER_ACTIONS.start,
    });
    return { reply: formatBrowserReplyText(result) };
  }

  if (parsed.name === "/browser-open" || parsed.name === "/browser-navigate") {
    const url = parsed.args[0];
    if (!url) {
      return { reply: "Uso: /browser-open <url>" };
    }
    const result = await tooling.browser.browserCommand({
      sessionKey: input.sessionKey,
      action: BROWSER_ACTIONS.open,
      url,
    });
    return { reply: formatBrowserReplyText(result) };
  }

  if (parsed.name === "/browser-snapshot") {
    const result = await tooling.browser.browserCommand({
      sessionKey: input.sessionKey,
      action: BROWSER_ACTIONS.snapshotText,
    });
    return { reply: formatBrowserReplyText(result) };
  }

  if (parsed.name === "/browser-shot" || parsed.name === "/browser-screenshot") {
    const result = await tooling.browser.browserCommand({
      sessionKey: input.sessionKey,
      action: BROWSER_ACTIONS.screenshot,
    });
    return { reply: formatBrowserReplyText(result) };
  }

  if (parsed.name === "/browser-click") {
    const selector = parsed.args.join(" ").trim();
    if (!selector) {
      return { reply: "Uso: /browser-click <selector>" };
    }
    const result = await tooling.browser.browserCommand({
      sessionKey: input.sessionKey,
      action: BROWSER_ACTIONS.click,
      selector,
    });
    return { reply: formatBrowserReplyText(result) };
  }

  if (parsed.name === "/browser-type") {
    if (parsed.args.length < 2) {
      return { reply: "Uso: /browser-type <selector> <texto>" };
    }

    const selector = parsed.args[0];
    const text = parsed.args.slice(1).join(" ").trim();
    if (!text) {
      return { reply: "Uso: /browser-type <selector> <texto>" };
    }
    const result = await tooling.browser.browserCommand({
      sessionKey: input.sessionKey,
      action: BROWSER_ACTIONS.type,
      selector,
      text,
    });
    return { reply: formatBrowserReplyText(result) };
  }

  if (parsed.name === "/browser-press") {
    const key = parsed.args[0]?.trim();
    if (!key) {
      return { reply: "Uso: /browser-press <tecla> [selector]" };
    }
    const result = await tooling.browser.browserCommand({
      sessionKey: input.sessionKey,
      action: BROWSER_ACTIONS.press,
      key,
      selector: parsed.args.slice(1).join(" ").trim() || undefined,
    });
    return { reply: formatBrowserReplyText(result) };
  }

  if (parsed.name === "/browser-wait") {
    const selector = parsed.args[0];
    if (!selector) {
      return { reply: "Uso: /browser-wait <selector> [timeoutMs]" };
    }
    const result = await tooling.browser.browserCommand({
      sessionKey: input.sessionKey,
      action: BROWSER_ACTIONS.waitFor,
      selector,
      timeoutMs: parseTimeout(parsed.args[1]),
    });
    return { reply: formatBrowserReplyText(result) };
  }

  if (parsed.name === "/browser-close") {
    const result = await tooling.browser.browserCommand({
      sessionKey: input.sessionKey,
      action: BROWSER_ACTIONS.close,
    });
    return { reply: formatBrowserReplyText(result) };
  }

  return null;
}

export async function runSimpleCommand(input: EngineTurnInput): Promise<EngineTurnOutput> {
  const parsed = parseCommand(input.message);
  if (!parsed) {
    return {
      reply:
        "Mensagem recebida. Para comandos de video use /help. Para conversa natural, ative KAEL_ENGINE_MODE=pi ou hybrid com chave da API.",
    };
  }

  if (parsed.name === "/help") {
    return helpReply();
  }

  if (parsed.name === "/jobs") {
    return listJobsReply(input.tooling);
  }

  if (parsed.name === "/youbora") {
    return handleYouboraCommand(parsed, input.tooling);
  }

  const videoReply = await handleVideoJobCommand(input, parsed, input.tooling);
  if (videoReply) {
    return videoReply;
  }

  const browserReply = await handleBrowserCommand(input, parsed, input.tooling);
  if (browserReply) {
    return browserReply;
  }

  return { reply: "Comando desconhecido. Use /help." };
}
