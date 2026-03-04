# Browser Control - Guia rapido (CLI/chat)

Este guia descreve como testar o browser control do Kael via chat CLI.

## Requisitos

- `KAEL_ENGINE_MODE=pi` ou `KAEL_ENGINE_MODE=hybrid`
- `KAEL_BROWSER_ENABLED=true`
- Chromium disponivel para Playwright

## Configuracao minima

```bash
export KAEL_ENGINE_MODE=pi
export KAEL_PI_API_KEY=<SUA_CHAVE>
export KAEL_BROWSER_ENABLED=true
export KAEL_BROWSER_HEADLESS=true
```

Opcional (hardening):

```bash
export KAEL_BROWSER_SESSION_TTL_MS=1200000
export KAEL_BROWSER_MAX_SESSIONS=4
export KAEL_BROWSER_MAX_SCREENSHOTS_PER_TURN=3
```

## Subir servidor

```bash
npm run dev
```

## Fluxo basico de teste (fast-path)

Use sempre o mesmo `--session` para manter a mesma sessao de browser.

```bash
# iniciar sessao
npx tsx src/cli/index.ts chat --session qa-site --message "/browser-start"

# abrir pagina
npx tsx src/cli/index.ts chat --session qa-site --message "/browser-open https://example.com"

# capturar texto da pagina
npx tsx src/cli/index.ts chat --session qa-site --message "/browser-snapshot"

# screenshot
npx tsx src/cli/index.ts chat --session qa-site --message "/browser-shot"

# fechar sessao
npx tsx src/cli/index.ts chat --session qa-site --message "/browser-close"
```

## Fluxo com interacao

```bash
npx tsx src/cli/index.ts chat --session qa-form --message "/browser-open https://duckduckgo.com"
npx tsx src/cli/index.ts chat --session qa-form --message "/browser-type input[name=q] kael browser test"
npx tsx src/cli/index.ts chat --session qa-form --message "/browser-press Enter input[name=q]"
npx tsx src/cli/index.ts chat --session qa-form --message "/browser-wait #links"
npx tsx src/cli/index.ts chat --session qa-form --message "/browser-shot"
```

## Comandos disponiveis

- `/browser-start`
- `/browser-open <url>`
- `/browser-navigate <url>`
- `/browser-snapshot`
- `/browser-shot`
- `/browser-screenshot`
- `/browser-click <selector>`
- `/browser-type <selector> <texto>`
- `/browser-press <tecla> [selector]`
- `/browser-wait <selector> [timeoutMs]`
- `/browser-close`

## Verificacao operacional

Cheque `GET /health` e valide `metrics.browserRuntime`:

- `activeSessions`
- `expiredSessionsClosed`
- `evictedSessions`
- `actionCalls`
- `actionFailures`
- `avgLatencyMsByAction`

