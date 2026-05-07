export type SdkMessageShape = {
  role: string | null;
  contentType: "string" | "array" | "object" | "null" | "unknown";
  blockTypes?: string[];
  textPreview?: string;
};

export function extractAssistantTextFromSdkMessage(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const directContent = (message as { content?: unknown }).content;
  if (typeof directContent === "string" && directContent.trim()) {
    return directContent.trim();
  }

  if (Array.isArray(directContent)) {
    const blocks = directContent.filter((block): block is { type?: unknown; text?: unknown } => {
      return Boolean(block && typeof block === "object");
    });

    const preferred = blocks
      .filter((block) => {
        const type = typeof block.type === "string" ? block.type.toLowerCase() : "";
        if (!type) {
          return true;
        }
        if (type.includes("input")) {
          return false;
        }
        if (type.includes("tool") || type.includes("reasoning")) {
          return false;
        }
        return type.includes("output") || type.includes("assistant") || type === "text";
      })
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .join("")
      .trim();
    if (preferred) {
      return preferred;
    }

    const fallback = blocks
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .join("")
      .trim();
    if (fallback) {
      return fallback;
    }
  }

  return null;
}

export function getSdkErrorMessage(event: unknown): string | null {
  if (!event || typeof event !== "object") {
    return null;
  }
  const value = (event as { errorMessage?: unknown }).errorMessage;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function sanitizeForDebug(value: unknown, depth = 0): unknown {
  if (value == null) {
    return value;
  }
  if (typeof value === "string") {
    return value.length > 800 ? `${value.slice(0, 800)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (depth >= 4) {
    return "[max-depth]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 16).map((item) => sanitizeForDebug(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[key] = sanitizeForDebug(inner, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function getSdkMessageShape(message: unknown): SdkMessageShape {
  if (!message || typeof message !== "object") {
    return { role: null, contentType: "null" };
  }
  const role = typeof (message as { role?: unknown }).role === "string" ? (message as { role: string }).role : null;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return {
      role,
      contentType: "string",
      textPreview: content.slice(0, 240),
    };
  }
  if (Array.isArray(content)) {
    const blocks = content.filter((block) => block && typeof block === "object");
    const blockTypes = blocks
      .map((block) => {
        const raw = (block as { type?: unknown }).type;
        return typeof raw === "string" ? raw : "unknown";
      })
      .slice(0, 20);
    const preview = blocks
      .map((block) => {
        const raw = (block as { text?: unknown; content?: unknown }).text;
        if (typeof raw === "string" && raw.trim()) {
          return raw.trim();
        }
        const nested = (block as { content?: unknown }).content;
        return typeof nested === "string" ? nested : "";
      })
      .filter((item) => item.length > 0)
      .join(" ")
      .slice(0, 240);
    return {
      role,
      contentType: "array",
      blockTypes,
      textPreview: preview || undefined,
    };
  }
  if (content && typeof content === "object") {
    return {
      role,
      contentType: "object",
      textPreview: JSON.stringify(sanitizeForDebug(content)).slice(0, 240),
    };
  }
  return {
    role,
    contentType: content == null ? "null" : "unknown",
  };
}
