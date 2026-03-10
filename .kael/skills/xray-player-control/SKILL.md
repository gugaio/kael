---
name: xray-player-control
description: Analisa logs de sessoes de video do Player X-Ray (Globo), identifica travamentos, problemas de buffer, erros de rede e performance HLS.js. Controla player remotamente enviando comandos e executando JavaScript no dispositivo.
argument-hint: "[sessionId] [deviceId]"
disable-model-invocation: false
user-invocable: true
---

# Skill: Controle, Analise e Diagnostico do Player X-Ray

## Quando Usar

- Quando o usuario mencionar "xray" ou "x-ray" e desejar analisar "logs de sessao", "travamento de video", "buffer", "playback stalling"
- Quando fornecer uma URL ou curl do Player X-Ray
- Para debug de problemas de streaming de video no X-Ray
- Para controlar o player remotamente (play, pause, seek, volume, mute, etc)

## Argumentos

- `$0` = sessionId (obrigatorio para logs)
- `$1` = deviceId (opcional para logs, obrigatorio para comandos)

## Endpoint da API

### URL Base

- **Producao (padrao):** `https://player-xray.globo.com`
- **Local:** `http://127.0.0.1:8888` (usar apenas quando explicitamente solicitado)

### Rotas

| Rota | Metodo | Descricao |
|------|--------|-----------|
| `/api/sessions/{sessionId}/logs` | GET | Logs sem deviceId |
| `/api/devices/{deviceId}/sessions/{sessionId}/logs` | GET | Logs com deviceId |
| `/api/devices/{deviceId}/messages/sync` | POST | Comandos sincronos (com confirmacao) |
| `/api/devices/{deviceId}/messages` | POST | Comandos fire-and-forget (apenas code_generated) |

### Parametros de Logs

- `cursor`: Posicao inicial (padrao: "0")
- `pageSize`: Logs por pagina (padrao: 50, maximo: 5000). **Sempre use 5000 para captura completa.**
- `order`: `asc` (cronologico) ou `desc` (mais recentes primeiro)

## Como Executar no Kael

Use a tool `exec` para chamadas curl. Exemplos:

### Consultar Logs

```bash
curl -s 'https://player-xray.globo.com/api/sessions/{sessionId}/logs?pageSize=5000&cursor=0&order=asc'
```

Com deviceId:

```bash
curl -s 'https://player-xray.globo.com/api/devices/{deviceId}/sessions/{sessionId}/logs?pageSize=5000&cursor=0&order=asc'
```

### Enviar Comando Sincrono

**TODOS os comandos usam `/messages/sync`** (exceto `code_generated`). Sempre inclua `correlation_id` unico.

```bash
curl -X POST 'https://player-xray.globo.com/api/devices/{deviceId}/messages/sync' \
  -H 'Content-Type: application/json' \
  -d '{"command":"play","correlation_id":"play-001"}'
```

### Executar Codigo JavaScript (fire-and-forget)

```bash
curl -X POST 'https://player-xray.globo.com/api/devices/{deviceId}/messages' \
  -H 'Content-Type: application/json' \
  -d '{"command":"code_generated","param":"(async () => { /* codigo */ })();"}'
```

## Comandos Disponiveis

### Controle de Reproducao

| Comando | Param | Descricao |
|---------|-------|-----------|
| `play` | - | Inicia/retoma reproducao |
| `pause` | - | Pausa reproducao |
| `stop` | - | Para reproducao completamente |
| `seek` | segundos (numero) | Navega para tempo especifico |
| `volume` | 0-100 (numero) | Define nivel de volume |
| `mute` | true/false | Ativa/desativa mudo |

### Controle de Idiomas e Legendas

| Comando | Param | Descricao |
|---------|-------|-----------|
| `open_language_menu` | - | Abre menu de idiomas |
| `close_language_menu` | - | Fecha menu de idiomas |
| `toggle_language_menu` | - | Alterna menu de idiomas |
| `set_subtitle` | id da trilha (ex: "pt-BR") | Define legenda |
| `set_audio` | id da trilha (ex: "en") | Define audio |

### Estado e Informacao

| Comando | Param | Descricao |
|---------|-------|-----------|
| `get_current_state` | - | Retorna estado atual do player |
| `get_device_volume` | - | Retorna volume/mudo atual |
| `code_instruction` | instrucao (string) | Envia instrucao de codigo |

### Regras de Comandos

- **Endpoint `/messages/sync`**: para TODOS os comandos exceto `code_generated`
- **`correlation_id` obrigatorio**: use valor unico (ex: UUID, timestamp)
- **Endpoint `/messages`** (sem sync): apenas para `code_generated` e `code_instruction`

## Execucao de Codigo JavaScript

### Regras Obrigatorias

1. Wrap em async IIFE: `(async () => { ... })()`
2. Sempre usar try/catch
3. Sempre usar async/await
4. Logar passos com `console.log`, erros com `console.error`

### Metodos do Player

```javascript
this.container.play()
this.container.pause()
this.container.stop()
this.container.seek(timeInSeconds)
this.container.mute()
this.container.setVolume(volume) // 0-100
this.container.currentTime       // propriedade: posicao atual
```

### Utilitarios

```javascript
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
```

### Proibido no Runtime

- Chamadas de rede: fetch, XMLHttpRequest, WebSocket
- Execucao dinamica: eval, Function()
- Loops infinitos
- DOM APIs: document, window, querySelector
- Estado global persistente

### Exemplo: Play por 5s e Pausar

```javascript
(async () => {
  try {
    console.log('Iniciando sequencia: play por 5s e pausar')
    await this.container.play()
    await sleep(5000)
    await this.container.pause()
    console.log('Sequencia concluida')
  } catch (error) {
    console.error('Erro:', error)
  }
})()
```

### Exemplo: Seek em Multiplos Pontos

```javascript
(async () => {
  try {
    const positions = [10, 30, 60, 120]
    for (const pos of positions) {
      console.log(`Seek para ${pos}s`)
      await this.container.seek(pos)
      await sleep(3000)
    }
    console.log('Teste de seeks concluido')
  } catch (error) {
    console.error('Erro:', error)
  }
})()
```

## Estrutura dos Logs

### Formato da Resposta

```json
{
  "data": [
    {
      "date_time": "2026-01-07T20:25:08.732Z",
      "level_name": "INFO|WARN|ERROR",
      "message": "[\"Playback paused\",{\"player_type\":\"hlsjs\"}]"
    }
  ],
  "next_cursor": 20,
  "has_more": true
}
```

**Importante**: O campo `message` e JSON stringificado. Sempre faca parse para acessar dados estruturados.

### Niveis de Log

- **INFO**: Eventos normais (play, pause, seek)
- **WARN**: Avisos (buffer baixo, stalling)
- **ERROR**: Erros criticos (falha de rede, erro de parse)

### Mensagens-Chave

| Tipo | Mensagem | Significado |
|------|----------|-------------|
| Travamento | `Playback stalling due to low buffer` | Buffer < 2s = problema serio |
| Rede | `FRAG_LOAD_ERROR` | Falha ao carregar fragmento |
| Rede | `MANIFEST_LOAD_ERROR` | Falha ao carregar manifest |
| Buffer | `BUFFER_APPENDED` | Dados adicionados ao buffer |
| Buffer | `BUFFER_FLUSHED` | Buffer limpo |
| Qualidade | `LEVEL_SWITCHED` | Mudanca de qualidade/bitrate |

## Processo de Analise (Passo a Passo)

### 1. Coletar Logs

```bash
curl -s 'https://player-xray.globo.com/api/sessions/{sessionId}/logs?pageSize=5000&cursor=0&order=asc' > /tmp/xray-logs.json
```

### 2. Resumo Rapido de Saude

```bash
echo "Total de logs:" $(jq '.data | length' /tmp/xray-logs.json)
echo "Erros:" $(jq '[.data[] | select(.level_name == "ERROR")] | length' /tmp/xray-logs.json)
echo "Warnings:" $(jq '[.data[] | select(.level_name == "WARN")] | length' /tmp/xray-logs.json)
echo "Stalling:" $(jq '[.data[] | select(.message | contains("stall"))] | length' /tmp/xray-logs.json)
```

### 3. Timeline de Eventos Criticos

```bash
jq -r '.data[] |
  select(.message | contains("stall") or contains("error") or contains("ERROR") or
         contains("paused") or contains("playing") or contains("seek")) |
  "\(.date_time) [\(.level_name)] \(.message)"' /tmp/xray-logs.json
```

### 4. Foco em Travamentos

```bash
jq -r '.data[] |
  select(.message | contains("stall")) |
  (.message | fromjson) as $msg |
  "\(.date_time) - \($msg[0]) - Detalhes: \($msg[1] | tostring)"' /tmp/xray-logs.json
```

### 5. Erros

```bash
jq -r '.data[] |
  select(.level_name == "ERROR") |
  "\(.date_time) - \(.message)"' /tmp/xray-logs.json | head -20
```

### 6. Buffer

```bash
jq -r '.data[] |
  select(.message | contains("buffer")) |
  (.message | fromjson) as $msg |
  "\(.date_time) - \($msg[0]) - \($msg[1].bufferLen // $msg[1])"' /tmp/xray-logs.json
```

### 7. Mudancas de Qualidade

```bash
jq -r '.data[] |
  select(.message | contains("LEVEL") or contains("quality")) |
  "\(.date_time) - \(.message)"' /tmp/xray-logs.json
```

## Padroes Comuns de Problemas

### Travamento no Inicio (primeiros 30s)

- **Sintoma**: Multiplos stalling, buffer < 1s
- **Causas**: Rede lenta, bitrate inicial alto, ABR nao ajustando
- **Buscar**: Tempo entre `playing` e primeiro `stall`, `FRAG_LOAD_ERROR` proximos

### Travamentos Intermitentes

- **Sintoma**: Stalling periodico, buffer em ciclos
- **Causas**: Flutuacao de rede, ABR inadequado, device nao decodifica rapido

### Erros de Carregamento

- **Sintoma**: `FRAG_LOAD_ERROR` ou `MANIFEST_LOAD_ERROR`
- **Causas**: Problema no CDN, URL expirada, CORS, timeout

### Performance do Device

- **Sintoma**: Travamentos com buffer alto, lentidao geral
- **Causas**: Hardware limitado, memoria insuficiente, codec nao otimizado

## Template de Relatorio

Ao gerar relatorio, use este formato:

```
# Analise de Logs - Player X-Ray

## Informacoes da Sessao
- **Device**: {deviceId}
- **Session**: {sessionId}
- **Periodo**: {inicio} ate {fim}

## Resumo Executivo
{problema principal}

## Problemas Identificados
### 1. {tipo}
- **Severidade**: Alta / Media / Baixa
- **Primeira Ocorrencia**: {timestamp}
- **Frequencia**: {n vezes}
- **Causa Provavel**: {hipotese}

## Metricas
- Buffer Medio: {valor}s
- Travamentos: {n}
- Erros de Rede: {n}
- Mudancas de Qualidade: {n}

## Recomendacoes
1. {acao especifica}
```

## Glossario HLS.js

- **FRAG**: Fragment (chunk de video)
- **MANIFEST**: Arquivo .m3u8 com info do stream
- **LEVEL**: Qualidade/bitrate do stream
- **ABR**: Adaptive Bitrate (ajuste automatico de qualidade)
- **Buffer**: Dados pre-carregados em memoria
- **Stalling**: Congelamento por falta de dados
