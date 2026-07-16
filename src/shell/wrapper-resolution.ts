/**
 * Detecção e desempacotamento de shell wrappers.
 *
 * Reconhece wrappers como sudo, timeout, nohup, nice, chrt, env, bash -c, sh -c
 * e extrai recursivamente o comando real para análise de allowlist.
 */

type WrapperKind =
  | "sudo"
  | "doas"
  | "timeout"
  | "nohup"
  | "nice"
  | "chrt"
  | "env"
  | "setsid"
  | "stdbuf"
  | "taskset"
  | "ionice"
  | "bash_c"
  | "sh_c";

type ShellWrapper = {
  kind: WrapperKind;
  command: string;
  args: string[];
};

type UnwrappedCommand = {
  wrappers: ShellWrapper[];
  /** Comando real (primeiro token após desempacotar todos os wrappers). */
  command: string;
  /** Argumentos do comando real. */
  args: string[];
  /** String completa do comando real (incluindo args). */
  fullCommand: string;
};

/** Wrappers que aceitam `-n valor` como flag numérica antes do comando. */
const FLAGGED_WRAPPERS: Array<{
  kind: WrapperKind;
  names: string[];
  flagCount: number;
}> = [
  { kind: "nice", names: ["nice"], flagCount: 1 },
  { kind: "chrt", names: ["chrt"], flagCount: 3 },
  { kind: "timeout", names: ["timeout", "gtimeout"], flagCount: 1 },
  { kind: "ionice", names: ["ionice"], flagCount: 2 },
];

/** Dispatch wrappers (sem flag, apenas pass-through). */
const DISPATCH_WRAPPERS: Array<{
  kind: WrapperKind;
  names: string[];
}> = [
  { kind: "sudo", names: ["sudo"] },
  { kind: "doas", names: ["doas"] },
  { kind: "nohup", names: ["nohup"] },
  { kind: "setsid", names: ["setsid"] },
  { kind: "stdbuf", names: ["stdbuf"] },
  { kind: "taskset", names: ["taskset"] },
  { kind: "env", names: ["env"] },
];

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
    } else if (ch === " " && !inSingle && !inDouble) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function isShellBin(name: string): boolean {
  const lower = name.toLowerCase().replace(/^['"]|['"]$/g, "");
  return ["bash", "sh", "dash", "zsh", "ksh", "fish"].includes(lower);
}

function unwrapShellC(tokens: string[], idx: number): { wrapper: ShellWrapper; nextIdx: number } | null {
  if (idx + 2 >= tokens.length) return null;
  const bin = tokens[idx].toLowerCase();
  if (!isShellBin(bin)) return null;

  const flag = tokens[idx + 1];
  if (flag !== "-c" && flag !== "'-c'" && flag !== '"-c"') return null;

  // O resto após -c é o comando real
  const restTokens = tokens.slice(idx + 2);
  const fullCommand = restTokens.join(" ");

  return {
    wrapper: { kind: bin === "sh" ? "sh_c" : "bash_c", command: fullCommand, args: restTokens },
    nextIdx: tokens.length,
  };
}

function tryUnwrapDispatch(tokens: string[], idx: number): { wrapper: ShellWrapper; nextIdx: number } | null {
  const lower = tokens[idx].toLowerCase();
  for (const w of DISPATCH_WRAPPERS) {
    if (w.names.includes(lower)) {
      const rest = tokens.slice(idx + 1);
      if (rest.length === 0) return null;
      return {
        wrapper: { kind: w.kind, command: rest.join(" "), args: rest },
        nextIdx: idx + 1,
      };
    }
  }
  return null;
}

function tryUnwrapFlagged(tokens: string[], idx: number): { wrapper: ShellWrapper; nextIdx: number } | null {
  const lower = tokens[idx].toLowerCase();
  for (const w of FLAGGED_WRAPPERS) {
    if (w.names.includes(lower)) {
      // Pula flags: -n, --flag=value, -n valor
      let cursor = idx + 1;
      let flagsConsumed = 0;
      while (cursor < tokens.length && flagsConsumed < w.flagCount) {
        const t = tokens[cursor];
        if (t.startsWith("-")) {
          if (t.includes("=")) {
            cursor++;
            continue;
          }
          cursor++;
          if (cursor < tokens.length && !tokens[cursor].startsWith("-")) {
            cursor++;
          }
        } else {
          cursor++;
        }
        flagsConsumed++;
      }
      if (cursor >= tokens.length) return null;
      const rest = tokens.slice(cursor);
      return {
        wrapper: { kind: w.kind, command: rest.join(" "), args: rest },
        nextIdx: cursor,
      };
    }
  }
  return null;
}

const MAX_UNWRAP_DEPTH = 8;

/**
 * Desempacota recursivamente wrappers shell, retornando o comando real
 * e a cadeia de wrappers aplicados.
 *
 * Exemplo:
 * ```
 * unwrapCommand("sudo nice -n 10 ffmpeg -i input.mp4")
 * // => {
 * //   wrappers: [{ kind: "sudo", ... }, { kind: "nice", ... }],
 * //   command: "ffmpeg",
 * //   args: ["-i", "input.mp4"],
 * //   fullCommand: "ffmpeg -i input.mp4"
 * // }
 * ```
 */
export function unwrapCommand(input: string): UnwrappedCommand | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const wrappers: ShellWrapper[] = [];
  let current = trimmed;
  let depth = 0;

  while (depth < MAX_UNWRAP_DEPTH) {
    const tokens = tokenizeCommand(current);
    if (tokens.length === 0) break;

    let matched: { wrapper: ShellWrapper; nextIdx: number } | null = null;

    // Tenta bash/sh -c primeiro (mais específico)
    matched = unwrapShellC(tokens, 0);
    if (!matched) matched = tryUnwrapFlagged(tokens, 0);
    if (!matched) matched = tryUnwrapDispatch(tokens, 0);

    if (!matched) break;

    wrappers.push(matched.wrapper);
    current = matched.wrapper.command;
    depth++;
  }

  const finalTokens = tokenizeCommand(current);
  if (finalTokens.length === 0) return null;

  const command = finalTokens[0].replace(/^['"]|['"]$/g, "");
  const args = finalTokens.slice(1);
  const fullCommand = current;

  return { wrappers, command, args, fullCommand };
}

/**
 * Retorna o comando real (primeiro binário após desempacotar wrappers),
 * ou o comando original se não houver wrapper.
 */
export function unwrapCommandName(input: string): string {
  const unwrapped = unwrapCommand(input);
  return unwrapped?.command ?? input.split(/\s+/)[0] ?? input;
}

/**
 * Retorna true se o comando usa um shell wrapper que deveria
 * ser desempacotado para análise de allowlist.
 */
export function hasShellWrapper(input: string): boolean {
  const unwrapped = unwrapCommand(input);
  return unwrapped !== null && unwrapped.wrappers.length > 0;
}
