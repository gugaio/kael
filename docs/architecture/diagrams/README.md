# Diagramas de Arquitetura - Kael

Esta pasta contém visões UML em Mermaid para entender a arquitetura do Kael de forma top-down.

## Diagramas Disponíveis

### 1. [Visão Geral de Componentes (Nível 1)](overview-components.md)

**Objetivo:** Visão de alto nível da arquitetura, focando nas camadas principais e seus relacionamentos.

**Conteúdo:**
- Processo único com Fastify HTTP/WS como gateway
- Camadas: Gateway → Orchestration → Domain Services → Storage
- Clientes externos (CLI, API, Discord, Email)
- Automação (Scheduler + Heartbeat)
- Storage (JSONL/JSON local)
- External dependencies (PI SDK, OpenAI, Tavily, Gmail)

**Para quem:** Novos contributors, revisores de arquitetura, engenharia de sistemas.

---

### 2. [Componentes Detalhados (Nível 2)](detailed-components.md)

**Objetivo:** Detalhar todos os serviços de domínio, contratos e suas interações.

**Conteúdo:**
- Todos os services de domínio com suas responsabilidades
- Contratos/interfaces principais (AgentEngine, EmailProvider, ShellRuntime, MediaUnderstandingService)
- ChatService como orquestrador central
- Pipeline multimodal (MediaUnderstandingService)
- Email pipeline (GmailPop3Provider → EmailIngestService)
- Engine hierarchy (Simple/PI/Hybrid)
- Video e Research services
- Tooling completo (20+ tools)

**Para quem:** Desenvolvedores implementando features, debugando issues, revisando PRs.

---

### 3. [Sequência de Chat Principal](sequence-chat-flow.md)

**Objetivo:** Mostrar o fluxo completo de uma mensagem de chat.

**Conteúdo:**
1. POST /chat com mensagem + anexos (opcional)
2. ChatService: roteamento (CommandRouter) → pré-processamento multimodal
3. MediaUnderstandingService: descrição de imagem/transcrição de audio
4. TurnOrchestrator: gestão de contexto
5. Engine (PiEngineAdapter): tool calling, PI SDK
6. Persistência de resposta no transcript JSONL
7. Retorno com reply + artifacts (opcional)

**Casos especiais:**
- Fast-path de slash commands
- Compactação de contexto
- Timeout do turno com evidências parciais
- Memory flush diário
- Artifacts multimodais

**Telemetria:**
- ChatRoutingTelemetry (fast_path vs llm_turn vs compact)
- MediaRuntimeTelemetry (processed, skipped, described, transcribed)
- EngineRuntimeTelemetry (timeouts, toolCallsByName, blockedCalls)

**Para quem:** Desenvolvedores implementando features, debugando issues de chat, otimizando performance.

---

## Como Usar os Diagramas

### Para Novos Contributors
1. Comece pelo **Nível 1** para entender a visão geral e as camadas.
2. Aprofunde no **Nível 2** para entender cada componente e seus contratos.
3. Veja o **diagrama de sequência** para entender o fluxo real de execução.

### Para Implementar Features
1. Consulte o **Nível 2** para identificar quais services/components tocar.
2. Veja o **diagrama de sequência** para entender como a feature afeta o fluxo.
3. Consulte as fases para entender o contexto histórico.

### Para Debugar Issues
1. Use o **diagrama de sequência** para rastrear o fluxo de execução.
2. Consulte o **Nível 2** para entender responsabilidades e contratos.
3. Verifique telemetria exposta em `/health`.

### Para Revisar Arquitetura
1. Compare o estado atual com os diagramas.
2. Atualize diagramas se houver mudanças estruturais.
3. Mantenha sincronia com fases em `../phases/`.

## Diagramas Futuros (Planejados)

- **Sequência de Email Ingress**: Email Poll → GmailPop3Provider → EmailIngestService → ChatService → Reply SMTP
- **Sequência de Multimodal Pipeline**: Anexo recebido → MediaUnderstanding → Contexto injetado → Engine → Artifact gerado → Email reply
- **Sequência de Job de Vídeo**: Tool call → video job builder → ProcessJobService → Job async → Poll/monitoramento
- **Estado de Jobs**: Transições de estado (queued → running → succeeded/failed/canceled)
- **Classes - ChatService e Orchestration**: ChatService, TurnOrchestrator, MemoryOrchestrator, CommandRouter
- **Classes - Engine e Adapters**: AgentEngine (interface), PiEngineAdapter, SimpleEngine, HybridEngine
- **Classes - Scheduler e Automação**: PersistentScheduler, HeartbeatRunner, AutomationService
- **Classes - Services de Domínio**: MemoryService, PlannerService, ResearchService, MediaUnderstandingService

## Formato

Todos os diagramas são em **Mermaid**, que:
- É renderizado nativamente no GitHub
- É fácil de versionar (texto puro)
- Não requer ferramentas externas
- Pode ser visualizado em qualquer editor Markdown

## Contribuindo

Quando fizer mudanças estruturais na arquitetura:
1. Atualize os diagramas correspondentes.
2. Atualize este README se adicionar/remover diagramas.
3. Atualize `../phases/` se afetar uma fase específica.
4. Teste visualização no GitHub Preview.

## Documentação Relacionada

- [Fases do Projeto](../phases/) - Evolução histórica da arquitetura
- [START HERE](../../core/START-HERE.md) - Onboarding inicial
- [PROJECT STATUS](../../planning/PROJECT-STATUS.md) - Estado atual
- [PROJECT VISION](../../planning/PROJECT-VISION.md) - Visão do projeto
