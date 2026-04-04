import { VideoJobValidationError } from "./safety.js";

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VideoJobValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new VideoJobValidationError(`${field} is required`);
  }
  return value.trim();
}

function optionalPositiveNumber(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new VideoJobValidationError(`${field} must be a positive number`);
  }
  return value;
}

function optionalStringArray(record: Record<string, unknown>, field: string): string[] | undefined {
  const value = record[field];
  if (value == null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new VideoJobValidationError(`${field} must be an array of strings`);
  }
  return value;
}

export function parseStartTranscodeParams(value: unknown): {
  sessionKey: string;
  inputPath: string;
  outputPath: string;
  args?: string[];
} {
  const record = asRecord(value, "transcode params");
  return {
    sessionKey: requireString(record, "sessionKey"),
    inputPath: requireString(record, "inputPath"),
    outputPath: requireString(record, "outputPath"),
    args: optionalStringArray(record, "args"),
  };
}

export function parseStartConvertHlsParams(value: unknown): {
  sessionKey: string;
  inputPath: string;
  outputPlaylistPath: string;
  segmentTime?: number;
} {
  const record = asRecord(value, "convert_hls params");
  return {
    sessionKey: requireString(record, "sessionKey"),
    inputPath: requireString(record, "inputPath"),
    outputPlaylistPath: requireString(record, "outputPlaylistPath"),
    segmentTime: optionalPositiveNumber(record, "segmentTime"),
  };
}

export function parseStartCaptureStreamParams(value: unknown): {
  sessionKey: string;
  streamUrl: string;
  outputPath: string;
  durationSeconds?: number;
} {
  const record = asRecord(value, "capture_stream params");
  return {
    sessionKey: requireString(record, "sessionKey"),
    streamUrl: requireString(record, "streamUrl"),
    outputPath: requireString(record, "outputPath"),
    durationSeconds: optionalPositiveNumber(record, "durationSeconds"),
  };
}

export function parseStartProbeMediaParams(value: unknown): {
  sessionKey: string;
  inputPath: string;
} {
  const record = asRecord(value, "probe_media params");
  return {
    sessionKey: requireString(record, "sessionKey"),
    inputPath: requireString(record, "inputPath"),
  };
}

export function parseStartProbeUrlParams(value: unknown): {
  sessionKey: string;
  streamUrl: string;
} {
  const record = asRecord(value, "probe_url params");
  return {
    sessionKey: requireString(record, "sessionKey"),
    streamUrl: requireString(record, "streamUrl"),
  };
}

export function parseStartPlayVlcParams(value: unknown): {
  sessionKey: string;
  input: string;
} {
  const record = asRecord(value, "play_vlc params");
  return {
    sessionKey: requireString(record, "sessionKey"),
    input: requireString(record, "input"),
  };
}
