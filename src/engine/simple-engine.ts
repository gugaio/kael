import type { AgentEngine, EngineToolingNamespaces, EngineTurnInput, EngineTurnOutput } from "./types.js";
import { resolveToolingNamespaces } from "./tooling-namespaces.js";
import { BROWSER_ACTIONS, formatBrowserReplyText } from "../capabilities/browser/index.js";

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

function listJobsReply(tooling: EngineToolingNamespaces): EngineTurnOutput {
  const jobs = tooling.jobs.listJobs().slice(0, 8);
  if (jobs.length === 0) {
    return { reply: "Nenhum job encontrado." };
  }

  const summary = jobs
    .map(
      (job) =>
        `- ${job.id} | ${job.capability}/${job.action} | ${job.status} | ${job.output ?? "(sem output)"}`,
    )
    .join("\n");

  return { reply: `Ultimos jobs:\n${summary}` };
}

async function handleYouboraCommand(
  parsed: ParsedCommand,
  tooling: EngineToolingNamespaces,
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
    const toDate = hasToDate ? second : undefined;
    const metrics = hasToDate ? third : second;
    const type = hasToDate ? fourth : third;
    const granularity = hasToDate ? fifth : fourth;
    const result = await tooling.edge.youboraMetricsGet({
      fromDate,
      toDate,
      metrics,
      type,
      granularity,
    });
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

  const [fromDate, second, third, ...rest] = args;
  const hasToDate = looksLikeYouboraBoundary(second);
  const toDate = hasToDate ? second : undefined;
  const type = hasToDate ? third : second;
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
        toDate,
        type,
        filters,
      })
    : await tooling.edge.youboraEventsGet({
        fromDate,
        toDate,
        type,
        filters,
      });
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

async function handleVideoJobCommand(
  input: EngineTurnInput,
  parsed: ParsedCommand,
  tooling: EngineToolingNamespaces,
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
    const segmentTime = segmentRaw ? Number(segmentRaw) : undefined;
    const job = await tooling.video.startConvertHls({
      sessionKey: input.sessionKey,
      inputPath,
      outputPlaylistPath,
      segmentTime,
    });
    return { reply: `HLS iniciado. jobId=${job.id}` };
  }

  if (parsed.name === "/capture") {
    if (parsed.args.length < 2) {
      return { reply: "Uso: /capture <streamUrl> <output> [durationSeconds]" };
    }
    const [streamUrl, outputPath, durationRaw] = parsed.args;
    const durationSeconds = durationRaw ? Number(durationRaw) : undefined;
    const job = await tooling.video.startCaptureStream({
      sessionKey: input.sessionKey,
      streamUrl,
      outputPath,
      durationSeconds,
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
    const fallbackUrl = extractUrl(input.message);
    const inputTarget = parsed.args[0] ?? fallbackUrl;
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

async function handleBrowserCommand(
  input: EngineTurnInput,
  parsed: ParsedCommand,
  tooling: EngineToolingNamespaces,
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
    const selector = parsed.args.slice(1).join(" ").trim() || undefined;
    const result = await tooling.browser.browserCommand({
      sessionKey: input.sessionKey,
      action: BROWSER_ACTIONS.press,
      key,
      selector,
    });
    return { reply: formatBrowserReplyText(result) };
  }

  if (parsed.name === "/browser-wait") {
    const selector = parsed.args[0];
    if (!selector) {
      return { reply: "Uso: /browser-wait <selector> [timeoutMs]" };
    }
    const timeoutRaw = parsed.args[1];
    const parsedTimeout = timeoutRaw ? Number(timeoutRaw) : undefined;
    const timeoutMs =
      parsedTimeout != null && Number.isFinite(parsedTimeout) && parsedTimeout > 0
        ? Math.floor(parsedTimeout)
        : undefined;
    const result = await tooling.browser.browserCommand({
      sessionKey: input.sessionKey,
      action: BROWSER_ACTIONS.waitFor,
      selector,
      timeoutMs,
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

export class SimpleCommandEngine implements AgentEngine {
  async runTurn(input: EngineTurnInput): Promise<EngineTurnOutput> {
    const tooling = resolveToolingNamespaces(input.tooling);
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
      return listJobsReply(tooling);
    }

    if (parsed.name === "/youbora") {
      return handleYouboraCommand(parsed, tooling);
    }

    const videoReply = await handleVideoJobCommand(input, parsed, tooling);
    if (videoReply) {
      return videoReply;
    }

    const browserReply = await handleBrowserCommand(input, parsed, tooling);
    if (browserReply) {
      return browserReply;
    }

    return { reply: "Comando desconhecido. Use /help." };
  }

  getRuntimeTelemetrySnapshot() {
    return {
      timeouts: 0,
      toolCallsByName: {},
      blockedCallsByTool: {},
    };
  }
}
