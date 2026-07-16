/**
 * Sanitização de variáveis de ambiente para execução no host local.
 *
 * Inspirado no modelo de segurança do openclaw (host-env-security-policy) e
 * hermes-agent (credential auto-stripping).
 * Filtra variáveis perigosas herdadas do processo pai antes de repassá-las
 * a subprocessos — evita LD_PRELOAD, BASH_ENV, NODE_OPTIONS, etc.
 *
 * Também detecta e remove dinamicamente credenciais do provedor
 * (qualquer variável com KEY, TOKEN, SECRET, PASSWORD, etc. no nome),
 * evitando que API keys vazem para ffmpeg, curl, scripts do agente.
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
 * Substrings que indicam que uma variável pode conter credenciais.
 * Qualquer var cujo nome contenha uma destas (case-insensitive) é removida.
 * Evita vazamento de API keys para subprocessos não confiáveis.
 */
const CREDENTIAL_PATTERNS: readonly string[] = [
  "KEY",
  "TOKEN",
  "SECRET",
  "PASSWORD",
  "PASSWD",
  "CREDENTIAL",
  "APIKEY",
  "API_KEY",
  "BEARER",
  "AUTH",
  "ACCESS_KEY",
  "ACCESS_KEY_ID",
  "SECRET_ACCESS_KEY",
  "SECRET_KEY",
  "PRIVATE_KEY",
  "SESSION_TOKEN",
  "AUTHORIZATION",
  "AUTH_TOKEN",
  "REFRESH_TOKEN",
  "WEBHOOK",
  "SIGNING_KEY",
  "ENCRYPTION_KEY",
  "MASTER_KEY",
  "SALT",
  "DSN",
  "SENTRY_DSN",
  "DATABASE_URL",
  "REDIS_URL",
  "AMQP_URL",
  "RABBITMQ_URL",
  "MONGODB_URI",
  "MONGODB_URL",
  "POSTGRES_URL",
  "PGURL",
  "MYSQL_URL",
  "CASSANDRA_URL",
  "ELASTICSEARCH_URL",
  "JAEGER_URL",
];

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
  if (BLOCKED_PREFIXES.some((prefix) => upper.startsWith(prefix))) {
    return true;
  }
  // Detecta dinamicamente credenciais por padrão de nome
  if (CREDENTIAL_PATTERNS.some((pattern) => upper.includes(pattern))) {
    return true;
  }
  return false;
}

/**
 * Retorna true se a variável parece conter uma credential pattern.
 * Útil para logging/debug sem bloquear.
 */
export function looksLikeCredential(key: string): boolean {
  const upper = key.trim().toUpperCase();
  if (!upper) return false;
  return CREDENTIAL_PATTERNS.some((pattern) => upper.includes(pattern));
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
