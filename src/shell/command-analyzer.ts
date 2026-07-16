import path from "node:path";

/**
 * Analisador de comandos shell.
 *
 * Diferente da abordagem anterior (regex avulsos), este módulo tokeniza
 * o comando por pipeline, chain (&&, ||), ; e analisa cada segmento
 * individualmente, permitindo:
 *
 * - Validar cada pipe/chain independentemente
 * - Bloquear pipe-to-shell (curl | bash)
 * - Rejeitar subshells, redirects perigosos, heredocs com eval
 * - Fornecer diagnóstico preciso por segmento
 */

export type ShellSegment = {
  /** Índice do segmento no comando completo. */
  index: number;
  /** Tipo de separador antes deste segmento: "pipe", "and", "or", "semi", ou "none" para o primeiro. */
  separator: "pipe" | "and" | "or" | "semi" | "none";
  /** Texto cru do segmento. */
  text: string;
  /** Primeiro token (binário) do segmento, sem path. */
  bin: string;
  /** Argumentos do segmento. */
  args: string[];
  /** Se o segmento contém subshell $(...) ou backticks. */
  hasSubshell: boolean;
  /** Se o segmento contém redirect de output (> / >>). */
  hasOutputRedirect: boolean;
  /** Se o segmento contém redirect de input (< / <<). */
  hasInputRedirect: boolean;
  /** Se o segmento parece um shell interativo (bash, sh, zsh, etc). */
  isShellBinary: boolean;
};

export type CommandAnalysis = {
  /** Comando original. */
  command: string;
  /** Segmentos individuais. */
  segments: ShellSegment[];
  /** Bins únicos de todos os segmentos. */
  bins: string[];
  /** Se o comando é seguro para allowlist. */
  ok: boolean;
  /** Motivo se não for seguro. */
  reason?: string;
  /** Se algum segmento pipeia para shell (ex: curl | bash). */
  hasPipeToShell: boolean;
  /** Se contém heredocs potencialmente perigosos. */
  hasDangerousHeredoc: boolean;
};

function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = i + 1 < input.length ? input[i + 1] : "";

    if (ch === "\\" && next) {
      current += ch + next;
      i++;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (!inSingle && !inDouble) {
      if (ch === " ") {
        if (current) {
          tokens.push(current);
          current = "";
        }
        continue;
      }

      // Detecta $() como um token
      if (ch === "$" && next === "(") {
        let depth = 1;
        let sub = "$(";
        i += 2;
        while (i < input.length && depth > 0) {
          if (input[i] === "(") depth++;
          if (input[i] === ")") depth--;
          if (depth > 0) sub += input[i];
          i++;
        }
        sub += ")";
        tokens.push(sub);
        continue;
      }

      // Detecta backticks como token
      if (ch === "`") {
        let backtick = "`";
        i++;
        while (i < input.length && input[i] !== "`") {
          backtick += input[i];
          i++;
        }
        backtick += "`";
        tokens.push(backtick);
        continue;
      }
    }

    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

const SHELL_BINARIES = new Set(["bash", "sh", "dash", "zsh", "ksh", "fish"]);

function isShellBin(name: string): boolean {
  return SHELL_BINARIES.has(name.toLowerCase());
}

function hasSubshell(token: string): boolean {
  return token.includes("$(") || token.includes("`");
}

const OUTPUT_REDIRECT = /^>>?$/;
const INPUT_REDIRECT = /^<<?$/;

/**
 * Divide um comando em segmentos por pipe, &&, ||, ;.
 * Respeita strings quoted.
 */
function splitSegments(tokens: string[]): Array<{
  tokens: string[];
  separator: "pipe" | "and" | "or" | "semi" | "none";
}> {
  const segments: Array<{ tokens: string[]; separator: "pipe" | "and" | "or" | "semi" | "none" }> = [];
  let current: string[] = [];
  let pendingSeparator: "pipe" | "and" | "or" | "semi" | "none" = "none";

  for (const token of tokens) {
    if (token === "|") {
      if (current.length > 0) {
        segments.push({ tokens: current, separator: pendingSeparator });
      }
      current = [];
      pendingSeparator = "pipe";
      continue;
    }
    if (token === "&&") {
      if (current.length > 0 || segments.length === 0) {
        segments.push({ tokens: current, separator: pendingSeparator });
      }
      current = [];
      pendingSeparator = "and";
      continue;
    }
    if (token === "||") {
      if (current.length > 0 || segments.length === 0) {
        segments.push({ tokens: current, separator: pendingSeparator });
      }
      current = [];
      pendingSeparator = "or";
      continue;
    }
    if (token === ";") {
      if (current.length > 0) {
        segments.push({ tokens: current, separator: pendingSeparator });
      }
      current = [];
      pendingSeparator = "semi";
      continue;
    }
    current.push(token);
  }

  if (current.length > 0 || segments.length === 0) {
    segments.push({ tokens: current, separator: pendingSeparator });
  }

  return segments;
}

/**
 * Analisa um comando shell completo, segmentando por pipe, &&, ||, ;.
 * Retorna análise detalhada de cada segmento.
 */
export function analyzeCommand(command: string): CommandAnalysis {
  const trimmed = command.trim();
  if (!trimmed) {
    return { command, segments: [], bins: [], ok: false, reason: "comando vazio", hasPipeToShell: false, hasDangerousHeredoc: false };
  }

  const tokens = tokenizeCommand(trimmed);
  const rawSegments = splitSegments(tokens);

  const segments: ShellSegment[] = [];
  const allBins = new Set<string>();
  let hasPipeToShell = false;
  let hasDangerousHeredoc = false;
  let firstReason: string | undefined;

  for (let i = 0; i < rawSegments.length; i++) {
    const raw = rawSegments[i];
    const segTokens = raw.tokens;

    // Detecta heredocs perigosos (delimitador sem quotes permite expansão)
    for (let j = 0; j < segTokens.length; j++) {
      if (segTokens[j] === "<<") {
        const delimiter = segTokens[j + 1];
        if (delimiter && !delimiter.startsWith("'") && !delimiter.startsWith('"') && !delimiter.startsWith("\\")) {
          hasDangerousHeredoc = true;
        }
      }
    }

    // Filtra redirect tokens para análise de args
    const filteredArgs: string[] = [];
    let skipNext = false;
    for (let j = 0; j < segTokens.length; j++) {
      if (skipNext) { skipNext = false; continue; }
      const t = segTokens[j];
      if (OUTPUT_REDIRECT.test(t) || INPUT_REDIRECT.test(t)) {
        skipNext = true; // pula o argumento do redirect
        continue;
      }
      filteredArgs.push(t);
    }

    const firstToken = filteredArgs[0] ?? "";
    const cleanBin = firstToken.replace(/^['"]|['"]$/g, "");
    const bin = path.basename(cleanBin).toLowerCase();
    const args = filteredArgs.slice(1);

    const segSubshell = filteredArgs.some((t) => hasSubshell(t));
    const segOutputRedirect = segTokens.some((t) => OUTPUT_REDIRECT.test(t));
    const segInputRedirect = segTokens.some((t) => INPUT_REDIRECT.test(t));
    const segIsShell = isShellBin(bin);

    if (segIsShell) {
      hasPipeToShell = true;
    }

    if (bin) {
      allBins.add(bin);
    }

    // Validação do segmento
    if (!firstToken && !firstReason) {
      firstReason = `segmento ${i + 1}: comando vazio`;
    } else if (segSubshell && !firstReason) {
      firstReason = `segmento ${i + 1}: substituicao de subshell nao permitida (${firstToken})`;
    } else if (raw.separator === "pipe" && segIsShell && !firstReason) {
      firstReason = `pipe para shell detectado no segmento ${i + 1}: ${bin}`;
    }

    segments.push({
      index: i,
      separator: raw.separator,
      text: segTokens.join(" "),
      bin,
      args,
      hasSubshell: segSubshell,
      hasOutputRedirect: segOutputRedirect,
      hasInputRedirect: segInputRedirect,
      isShellBinary: segIsShell,
    });
  }

  if (hasDangerousHeredoc && !firstReason) {
    firstReason = "heredoc sem delimitador quoted pode permitir expansao de variaveis";
  }

  return {
    command,
    segments,
    bins: Array.from(allBins),
    ok: !firstReason,
    reason: firstReason,
    hasPipeToShell,
    hasDangerousHeredoc,
  };
}
