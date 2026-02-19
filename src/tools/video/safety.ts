import fs from "node:fs/promises";
import path from "node:path";

export class VideoJobValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoJobValidationError";
  }
}

function hasControlChars(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function assertSafeToken(label: string, value: string): void {
  if (!value.trim()) {
    throw new VideoJobValidationError(`${label} cannot be empty`);
  }
  if (hasControlChars(value)) {
    throw new VideoJobValidationError(`${label} contains control characters`);
  }
}

function isPathInside(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(baseDir, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertPathAllowedByRoots(filePath: string, allowedRoots: string[]): void {
  const resolved = path.resolve(filePath);
  const allowed = allowedRoots.some((root) => isPathInside(path.resolve(root), resolved));
  if (!allowed) {
    throw new VideoJobValidationError(
      `path outside allowed roots: ${filePath}. Configure KAEL_ALLOWED_PATHS if needed`,
    );
  }
}

export async function validateExistingInputPath(params: {
  value: string;
  label: string;
  allowedRoots: string[];
  safePathsEnabled: boolean;
}): Promise<void> {
  assertSafeToken(params.label, params.value);
  if (params.value.includes("://")) {
    throw new VideoJobValidationError(`${params.label} must be a local file path`);
  }
  if (params.safePathsEnabled) {
    assertPathAllowedByRoots(params.value, params.allowedRoots);
  }
  try {
    await fs.access(path.resolve(params.value));
  } catch {
    throw new VideoJobValidationError(`${params.label} file does not exist: ${params.value}`);
  }
}

export function validateOutputPath(params: {
  value: string;
  label: string;
  allowedRoots: string[];
  safePathsEnabled: boolean;
}): void {
  assertSafeToken(params.label, params.value);
  if (params.value.includes("://")) {
    throw new VideoJobValidationError(`${params.label} must be a local file path`);
  }
  if (params.safePathsEnabled) {
    assertPathAllowedByRoots(params.value, params.allowedRoots);
  }
}

export function validateStreamUrl(value: string): void {
  assertSafeToken("streamUrl", value);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new VideoJobValidationError("streamUrl must be a valid URL");
  }
  const allowedProtocols = new Set(["http:", "https:", "rtsp:", "rtmp:", "udp:"]);
  if (!allowedProtocols.has(parsed.protocol)) {
    throw new VideoJobValidationError(`streamUrl protocol not allowed: ${parsed.protocol}`);
  }
}

export function validateUserArgs(args: string[] | undefined, maxArgs: number): string[] {
  if (!args || args.length === 0) {
    return [];
  }
  if (args.length > maxArgs) {
    throw new VideoJobValidationError(`args limit exceeded: max ${String(maxArgs)}`);
  }
  for (const token of args) {
    assertSafeToken("arg", token);
  }

  const blocked = new Set(["-i", "-y"]);
  if (args.some((token) => blocked.has(token.trim()))) {
    throw new VideoJobValidationError("args contain blocked options (-i or -y)");
  }
  return args;
}

