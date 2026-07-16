/**
 * Sanitização de variáveis de ambiente para execução no host local.
 *
 * Inspirado no modelo de segurança do openclaw (host-env-security-policy).
 * Filtra variáveis perigosas herdadas do processo pai antes de repassá-las
 * a subprocessos — evita LD_PRELOAD, BASH_ENV, NODE_OPTIONS, etc.
 */

// Variáveis bloqueadas por nome exato (case-insensitive)
const BLOCKED_KEYS: ReadonlySet<string> = new Set([
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONHOME",
  "PYTHONPATH",
  "PERL5LIB",
  "PERL5OPT",
  "RUBYLIB",
  "RUBYOPT",
  "BASH_ENV",
  "ENV",
  "SHELL",
  "SHELLOPTS",
  "PS4",
  "GCONV_PATH",
  "IFS",
  "SSLKEYLOGFILE",
]);

// Prefixos bloqueados (case-insensitive)
const BLOCKED_PREFIXES: readonly string[] = ["DYLD_", "LD_", "BASH_FUNC_"];

/**
 * Retorna `true` quando o nome da variável é considerado perigoso para
 * repassar a subprocessos do host.
 */
export function isDangerousHostEnvVarName(key: string): boolean {
  const upper = key.trim().toUpperCase();
  if (!upper) {
    return false;
  }
  if (BLOCKED_KEYS.has(upper)) {
    return true;
  }
  return BLOCKED_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

/**
 * Retorna uma cópia do env herdado sem variáveis perigosas.
 * PATH é preservado; variáveis extras fornecidas pelo chamador NÃO
 * passam por esta função (devem ser validadas separadamente).
 */
export function sanitizeHostEnv(
  env: NodeJS.ProcessEnv,
  extraDenylist?: ReadonlyArray<string>,
): Record<string, string> {
  const extraUpper = extraDenylist?.map((k) => k.trim().toUpperCase()) ?? [];
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }
    const upper = key.toUpperCase();
    // PATH é sempre preservado
    if (upper === "PATH") {
      result[key] = value;
      continue;
    }
    if (isDangerousHostEnvVarName(key)) {
      continue;
    }
    if (extraUpper.length > 0 && extraUpper.includes(upper)) {
      continue;
    }
    result[key] = value;
  }
  return result;
}
