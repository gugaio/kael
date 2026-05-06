# Diagrama de Sequência - Fluxo de Chat Principal

Este diagrama mostra o fluxo detalhado de uma mensagem de chat desde a entrada via API até a resposta, incluindo o pipeline multimodal e a persistência.

## Fluxo Principal

```mermaid
sequenceDiagram
    participant User as Usuário/Cliente
    participant API as Fastify API<br/>src/api/server.ts
    participant Chat as ChatService<br/>src/chat/service.ts
    participant CmdRouter as CommandRouter<br/>src/chat/command-router.ts
    participant Media as MediaUnderstanding<br/>src/media/service.ts
    participant MemOrch as MemoryOrchestrator<br/>src/memory/orchestrator.ts
    participant TurnOrch as TurnOrchestrator<br/>src/chat/turn-orchestrator.ts
    participant Session as SessionStore<br/>src/session/store.ts
    participant Engine as PiEngineAdapter<br/>src/agents/pi-engine-adapter.ts
    participant PiSDK as PI Agent SDK
    participant Tooling as EngineToolingNamespaces
    participant VideoJob as VideoJobService
    participant Memory as MemoryService

    User->>API: POST /chat<br/>{sessionKey, message, attachments?}

    API->>API: Validar payload<br/>(idempotency signature)

    API->>Chat: handleMessage()<br/>{sessionKey, message, attachments, source, requestId}

    Note over Chat: Persistir mensagem do usuário
    Chat->>Session: appendMessage()<br/>(role: user, content, attachments?)

    Chat->>CmdRouter: route(message, source)

    alt É slash command e shortcuts habilitados?
        CmdRouter-->>Chat: fast_path<br/>{command, params}
        Note over Chat: Executar via SimpleCommandEngine<br/>(determinístico, sem LLM)
        Chat->>VideoJob: Executar tool de vídeo<br/>(transcode/HLS/capture/probe/VLC)
        VideoJob-->>Chat: Job iniciado/resultado
        Chat->>Session: appendMessage()<br/>(role: assistant, reply)
        Chat-->>API: {userMessage, assistantMessage, reply, artifacts?}
    else É comando especial /compact?
        Chat->>MemOrch: handleCompactCommand()
        MemOrch->>Memory: memoryFlush(daily)
        Memory-->>MemOrch: {written, paths}
        MemOrch->>TurnOrch: compactContext()
        TurnOrch-->>MemOrch: {compacted, oldLines, newLines}
        MemOrch-->>Chat: {compacted, flushed}
        Chat->>Session: appendMessage()<br/>(role: assistant, status)
        Chat-->>API: {userMessage, assistantMessage, reply}
    else Mensagem livre ou chat-only?
        Chat->>Chat: handleMessageInternal(tooling, {allowOperationalShortcuts})

        Note over Chat: Pré-processamento multimodal
        alt Anexos presentes e media habilitado?
            Chat->>Media: processAttachments(attachments, source)
            Media->>Media: Aplicar budget<br/>(maxAttachments, maxBytes, maxPerSource)
            loop Para cada anexo dentro do budget
                alt Anexo é imagem
                    Media->>Media: OpenAI vision API<br/>GPT-4o: image description
                else Anexo é audio
                    Media->>Media: OpenAI Whisper API<br/>audio transcription
                end
            end
            Media-->>Chat: {[media_context]: descriptions + transcriptions}
        else Anexos fora do budget ou media desabilitado
            Media-->>Chat: null (omitir contexto)
        end

        Note over Chat: Injetar contexto multimodal na mensagem
        Chat->>Chat: messageWithMediaContext = message + mediaContext

        Note over Chat: Memory flush antes do turno (se necessário)
        Chat->>MemOrch: maybeFlushBeforeTurn()
        MemOrch->>Memory: memoryWrite(daily)
        Memory-->>MemOrch: ok
        MemOrch-->>Chat: ok

        Chat->>TurnOrch: runTurn()<br/>{sessionKey, messageWithMediaContext, tooling, attachments?}

        Note over TurnOrch: Gestão de contexto
        TurnOrch->>Session: getRecentMessages(maxMessages)
        Session-->>TurnOrch: [{role, content, createdAt}, ...]

        TurnOrch->>TurnOrch: buildContextMessages()<br/>(system prompt + recent messages)

        Note over TurnOrch: Verificar context overflow
        alt Contexto excede maxChars?
            TurnOrch->>TurnOrch: compactContext()<br/>(LLM-guided summary)
            TurnOrch->>Session: appendCompactionMarker()
        end

        TurnOrch->>Engine: runTurn()<br/>{sessionKey, message, contextMessages, tooling, attachments, requestId}

        Note over Engine: PI SDK turn execution
        Engine->>PiSDK: runAgent()<br/>{systemPrompt, messages, tools}

        loop Tool calling loop
            PiSDK-->>Engine: toolCall<br/>{name, args}
            Engine->>Tooling: Executar tool no namespace correto

            alt Tool é exec/process?
                Engine->>ShellToolService: exec/process
                ShellToolService->>Supervisor: start/poll/kill
                Supervisor-->>ShellToolService: {ok, session}
                ShellToolService-->>Tooling: {id, command, status, output, failureCode}
            else Tool é memory_search?
                Engine->>Memory: search(query, maxResults)
                Memory-->>Tooling: [{path, snippet, score}, ...]
            else Tool é web_search/web_fetch/web_research?
                Engine->>ResearchService: search/fetch/research
                ResearchService->>Tavily: search API
                Tavily-->>ResearchService: {results, summary, sources}
                ResearchService-->>Tooling: {summary, evidence, confidence}
            else Tool é video (transcode/HLS/capture/probe)?
                Engine->>VideoJobService: startTranscode/startConvertHls/etc.
                VideoJobService-->>Tooling: {id, status, command, input, output}
            else Tool é image_generate?
                Engine->>ImageGenerator: generate(prompt, size)
                ImageGenerator->>OpenAI: /images/generations
                OpenAI-->>ImageGenerator: {image: base64, mimeType}
                ImageGenerator-->>Tooling: {kind: image, dataBase64, mimeType, fileName}
            end

            Tooling-->>Engine: toolResult
            Engine->>PiSDK: returnToolResult()
        end

        PiSDK-->>Engine: agentOutput<br/>{reply, artifacts?}

        Note over Engine: Coletar artifacts de tools
        alt Tools emitiram artifacts?
            Engine->>Engine: collectArtifacts()<br/>(ex: image_generate)
        end

        Engine-->>TurnOrch: {reply, artifacts?}

        Note over TurnOrch: Persistir resposta do assistente
        TurnOrch->>Session: appendMessage()<br/>(role: assistant, reply)

        TurnOrch-->>Chat: {reply, artifacts?}

        Note over Chat: Persistir resposta no transcript
        Chat->>Session: appendMessage()<br/>(role: assistant, reply, artifacts?)

        Chat-->>API: {userMessage, assistantMessage, reply, artifacts?}
    end

    API-->>User: 200 OK<br/>{user, assistant, reply, artifacts?}
```

## Fluxo por Etapa

### 1. Recebimento da Mensagem
1. Cliente faz `POST /chat` com `{sessionKey, message, attachments?, source?, requestId?}`
2. API valida payload (incluindo idempotency signature com attachments)
3. ChatService persiste mensagem do usuário no transcript JSONL

### 2. Roteamento (CommandRouter)
- **Slash commands** → Fast-path via SimpleCommandEngine (determinístico)
- **Comando especial `/compact`** → MemoryOrchestrator (flush + compactação)
- **Mensagem livre ou chat-only** → Fluxo completo com PI Engine

### 3. Pré-processamento Multimodal
**Se anexos presentes e media habilitado:**
1. MediaUnderstandingService aplica budget (maxAttachments, maxBytes, maxPerSource)
2. Para cada anexo dentro do budget:
   - Imagem → OpenAI vision API (GPT-4o) para descrição
   - Audio → OpenAI Whisper API para transcrição
3. Injeta bloco `[media_context]` na mensagem do usuário

**Caso contrário:**
- Anexos fora do budget ou media desabilitado → Omite contexto multimodal

### 4. Memory Flush (Pré-turno)
- MemoryOrchestrator faz flush de memória diária antes do turno (se necessário)
- Evita perda de memória em caso de timeout/erro do turno

### 5. Turn Orchestration
**Gestão de contexto:**
1. Recupera mensagens recentes (maxMessages)
2. Constroi contextMessages (system prompt + recent messages)
3. Verifica context overflow:
   - Se excede maxChars → Compacta contexto (LLM-guided summary)
   - Persiste marcador de compaction no transcript

### 6. Engine Turn (PI Agent SDK)
**Tool calling loop:**
1. PI SDK executa agente com system prompt (SOUL.md)
2. Agente decide se precisa chamar tools
3. Para cada tool call:
   - Engine executa via `EngineToolingNamespaces`
   - Tooling despacha para service apropriado
   - Resultado retornado ao PI SDK
4. Loop continua até agente decidir finalizar
5. PI SDK retorna reply + artifacts (se aplicável)

### 7. Persistência e Resposta
1. TurnOrchestrator persiste resposta do assistente
2. ChatService persiste no transcript com artifacts (se aplicável)
3. API retorna `{user, assistant, reply, artifacts?}`

## Casos Especiais

### Fast-Path de Slash Commands
Comandos operacionais são roteados diretamente sem passar pelo LLM:
- `/jobs`, `/probe`, `/transcode`, `/convertHLS`, `/captureStream`, `/playVLC`
- Reduz latência e custo de API

### Compactação de Contexto
Quando contexto excede limite:
- TurnOrchestrator compacta via LLM-guided summary
- Mantém mensagens importantes + resumo
- Registra marcador de compaction no transcript

### Timeout do Turn
Se PI SDK timeout:
- ChatService retorna fallback com evidências parciais
- Inclui resumo de tools executadas (web_search/web_fetch/web_research)
- Mensagem de erro amigável

### Memory Flush Diário
Antes do turno, se necessário:
- MemoryOrchestrator faz flush de memória diária
- Persiste em `memory/YYYY-MM-DD.md`
- Permite recuperação de memória futura

### Artifacts Multimodais
Tools podem emitir artifacts (ex: `image_generate`):
1. PiEngineAdapter coleta artifacts emitidos por tools
2. Retorna artifacts no `EngineTurnOutput`
3. ChatService expõe na resposta API
4. Email reply anexa artifacts (imagem gerada)

## Telemetria

### ChatRoutingTelemetry
- `fast_path`: Turnos roteados via fast-path
- `llm_turn`: Turnos processados via LLM
- `compact`: Turnos com compactação de contexto

### MediaRuntimeTelemetry
- `processedAttachments`: Anexos processados
- `skippedTooLarge`: Anexos muito grandes
- `skippedBySourceLimit`: Anexos fora do limite por origem
- `skippedByTotalBytesBudget`: Anexos fora do limite total
- `skippedByProcessingBudget`: Anexos fora do limite de processamento
- `imageDescribed`: Imagens descritas
- `audioTranscribed`: Audios transcritos
- `failures`: Falhas no processamento multimodal

### EngineRuntimeTelemetry
- `timeouts`: Total de timeouts
- `toolCallsByName`: Contador de chamadas por tool
- `blockedCallsByTool`: Contador de chamadas bloqueadas (loop guard)

## Documentação Relacionada

- [Visão Geral de Componentes (Nível 1)](overview-components.md)
- [Componentes Detalhados (Nível 2)](detailed-components.md)
- [Fase 11: Reply Orchestrator Lite](../phases/phase-11.md)
- [Fase 15: Multimodal Ingress MVP](../phases/phase-15.md)
