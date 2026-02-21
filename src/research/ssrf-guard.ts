import dns from "node:dns/promises";
import net from "node:net";

type LookupAddress = {
  address: string;
  family: number;
};

export type HostLookup = (hostname: string) => Promise<LookupAddress[]>;

function isBlockedHostname(hostname: string): boolean {
  const value = hostname.trim().toLowerCase();
  if (!value) {
    return true;
  }
  if (value === "localhost" || value.endsWith(".localhost")) {
    return true;
  }
  if (value.endsWith(".local") || value.endsWith(".internal") || value.endsWith(".lan")) {
    return true;
  }
  return false;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((item) => Number.parseInt(item, 10));
  if (parts.length !== 4 || parts.some((item) => !Number.isFinite(item) || item < 0 || item > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a >= 224) {
    return true;
  }
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? address.toLowerCase();
  if (normalized === "::1" || normalized === "::") {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (net.isIP(mapped) === 4) {
      return isPrivateIpv4(mapped);
    }
  }
  return false;
}

function isPrivateIp(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) {
    return false;
  }
  if (family === 4) {
    return isPrivateIpv4(address);
  }
  if (family === 6) {
    return isPrivateIpv6(address);
  }
  return false;
}

export async function assertPublicHttpUrl(input: {
  url: string;
  lookup?: HostLookup;
}): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new Error("invalid url");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("url must be http/https");
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new Error(`blocked hostname: ${parsed.hostname}`);
  }
  if (isPrivateIp(parsed.hostname)) {
    throw new Error(`blocked private ip: ${parsed.hostname}`);
  }
  if (net.isIP(parsed.hostname) !== 0) {
    return;
  }

  const lookup = input.lookup ?? (async (hostname: string) => dns.lookup(hostname, { all: true }));
  const resolved = await lookup(parsed.hostname).catch(() => {
    throw new Error(`dns lookup failed for hostname: ${parsed.hostname}`);
  });
  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw new Error(`dns lookup returned no addresses for hostname: ${parsed.hostname}`);
  }
  for (const item of resolved) {
    if (!item || typeof item.address !== "string") {
      throw new Error(`invalid dns address for hostname: ${parsed.hostname}`);
    }
    if (isPrivateIp(item.address)) {
      throw new Error(`blocked private resolved ip: ${parsed.hostname} -> ${item.address}`);
    }
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export async function fetchWithSsrFGuard(params: {
  url: string;
  fetchImpl?: typeof fetch;
  lookup?: HostLookup;
  maxRedirects?: number;
  timeoutMs: number;
  headers?: HeadersInit;
}): Promise<{ response: Response; finalUrl: string }> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const maxRedirects =
    typeof params.maxRedirects === "number" && Number.isFinite(params.maxRedirects)
      ? Math.max(0, Math.floor(params.maxRedirects))
      : 3;
  const startedAt = Date.now();
  let currentUrl = params.url;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    await assertPublicHttpUrl({ url: currentUrl, lookup: params.lookup });
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(1, params.timeoutMs - elapsed);
    const response = await fetchImpl(currentUrl, {
      method: "GET",
      headers: params.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(remaining),
    });
    if (!isRedirectStatus(response.status)) {
      return { response, finalUrl: currentUrl };
    }
    if (redirectCount >= maxRedirects) {
      throw new Error(`too many redirects (>${maxRedirects})`);
    }
    const location = response.headers.get("location");
    if (!location) {
      throw new Error("redirect response without location");
    }
    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error("unreachable redirect state");
}
