import { fetchWithSsrFGuard } from "./ssrf-guard.js";
import type { HostLookup } from "./ssrf-guard.js";
import { wrapExternalContent } from "../security/external-content.js";

export type FetchedWebContent = {
  url: string;
  finalUrl: string;
  title?: string;
  content: string;
  excerpt: string;
  contentType?: string;
  fetchedAt: string;
  warning?: string;
};

type ReadResponseTextResult = {
  text: string;
  truncated: boolean;
  bytesRead: number;
};

export function clip(input: string, maxChars: number): string {
  if (input.length <= maxChars) {
    return input;
  }
  return `${input.slice(0, Math.max(0, maxChars - 3))}...`;
}

function wrapWebFetchText(value: string | undefined): string | undefined {
  if (!value || !value.trim()) {
    return value;
  }
  return wrapExternalContent(value, { source: "web_fetch", includeWarning: false });
}

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractByTag(html: string, tag: string): string[] {
  const out: string[] = [];
  const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1] ?? "";
    const text = stripHtml(raw);
    if (text) {
      out.push(text);
    }
  }
  return out;
}

function extractLikelyContentDivs(html: string): string[] {
  const out: string[] = [];
  const regex =
    /<(section|div)\b[^>]*(?:id|class)=["'][^"']*(content|article|main|post|entry|body)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const raw = match[3] ?? "";
    const text = stripHtml(raw);
    if (text) {
      out.push(text);
    }
  }
  return out;
}

function removeNoiseBlocks(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ");
}

function pickBestCandidate(candidates: string[]): string | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  const ranked = [...candidates]
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 0)
    .sort((a, b) => b.length - a.length);
  return ranked[0];
}

function extractReadableHtmlText(html: string): string {
  const withoutNoise = removeNoiseBlocks(html);
  const candidates = [
    ...extractByTag(withoutNoise, "article"),
    ...extractByTag(withoutNoise, "main"),
    ...extractLikelyContentDivs(withoutNoise),
  ];
  const best = pickBestCandidate(candidates);
  if (best && best.length >= 120) {
    return best;
  }
  const bodyMatch = withoutNoise.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch?.[1]) {
    return stripHtml(bodyMatch[1]);
  }
  return stripHtml(withoutNoise);
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) {
    return undefined;
  }
  const text = stripHtml(match[1]).trim();
  return text || undefined;
}

async function readResponseTextLimited(res: Response, maxBytes: number): Promise<ReadResponseTextResult> {
  const body = (res as unknown as { body?: unknown }).body;
  if (
    body &&
    typeof body === "object" &&
    "getReader" in body &&
    typeof (body as { getReader: () => unknown }).getReader === "function"
  ) {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let bytesRead = 0;
    let truncated = false;
    const parts: string[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        if (!value || value.byteLength === 0) {
          continue;
        }
        let chunk = value;
        if (bytesRead + chunk.byteLength > maxBytes) {
          const remaining = Math.max(0, maxBytes - bytesRead);
          if (remaining <= 0) {
            truncated = true;
            break;
          }
          chunk = chunk.subarray(0, remaining);
          truncated = true;
        }
        bytesRead += chunk.byteLength;
        parts.push(decoder.decode(chunk, { stream: true }));
        if (truncated || bytesRead >= maxBytes) {
          truncated = true;
          break;
        }
      }
    } finally {
      if (truncated) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
      }
    }
    parts.push(decoder.decode());
    return { text: parts.join(""), truncated, bytesRead };
  }

  const raw = await res.text();
  const encoded = new TextEncoder().encode(raw);
  if (encoded.byteLength <= maxBytes) {
    return { text: raw, truncated: false, bytesRead: encoded.byteLength };
  }
  const clipped = encoded.slice(0, maxBytes);
  return { text: new TextDecoder().decode(clipped), truncated: true, bytesRead: maxBytes };
}

export async function fetchAndExtractWebContent(params: {
  url: string;
  fetchImpl: typeof fetch;
  lookup?: HostLookup;
  timeoutMs: number;
  fetchMaxRedirects: number;
  fetchMaxResponseBytes: number;
  maxChars: number;
}): Promise<FetchedWebContent> {
  const parsed = new URL(params.url);
  const guarded = await fetchWithSsrFGuard({
    url: parsed.toString(),
    fetchImpl: params.fetchImpl,
    lookup: params.lookup,
    timeoutMs: params.timeoutMs,
    maxRedirects: params.fetchMaxRedirects,
    headers: {
      "user-agent": "KaelResearchBot/0.1 (+local-agent)",
      accept: "text/html, text/plain;q=0.9, */*;q=0.7",
    },
  });
  const response = guarded.response;
  if (!response.ok) {
    throw new Error(`web_fetch failed status=${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? undefined;
  const bodyResult = await readResponseTextLimited(response, params.fetchMaxResponseBytes);
  const raw = bodyResult.text;
  const warning = bodyResult.truncated
    ? `Response body truncated after ${params.fetchMaxResponseBytes} bytes.`
    : undefined;
  const htmlLike = (contentType ?? "").toLowerCase().includes("html") || raw.includes("<html");
  const title = htmlLike ? extractTitle(raw) : undefined;
  const cleaned = htmlLike ? extractReadableHtmlText(raw) : raw.replace(/\s+/g, " ").trim();
  const content = clip(cleaned, params.maxChars);
  const excerpt = clip(content, Math.min(300, params.maxChars));
  const fetchedAt = new Date().toISOString();
  const finalUrl = guarded.finalUrl || response.url || parsed.toString();

  return {
    url: parsed.toString(),
    finalUrl,
    title: wrapWebFetchText(title),
    content: wrapWebFetchText(content) ?? content,
    excerpt: wrapWebFetchText(excerpt) ?? excerpt,
    contentType,
    fetchedAt,
    warning,
  };
}
