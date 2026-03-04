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

## Smoke e2e automatizado

O projeto inclui smoke de browser real com pagina embutida (`data:` URL, sem dependencia externa):

```bash
npm run test:smoke:browser
```

Observacao: em ambientes restritos (sandbox/CI sem permissao de launch do Chromium), o smoke pode encerrar sem validar o fluxo para nao quebrar a suite padrao.

Esse teste valida o fluxo:

1. `open` em servidor HTTP local.
2. `type` em campo `#q`.
3. `press Enter` com foco no input.
4. `wait_for #result`.
5. `snapshot_text` com verificacao de conteudo.
6. `screenshot` com arquivo salvo.
7. `close` da sessao.
