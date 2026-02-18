# OpenClaw: Como Utiliza o Framework Pi-Agent

## Introdução

O **OpenClaw** é um gateway de mensagens multi-canal alimentado por IA, construído sobre o framework **Pi-Agent** desenvolvido por Mario Zechner. Este guia explora a arquitetura técnica do OpenClaw e como os componentes do Pi-Agent são integrados.

## 1. O Framework Pi-Agent

### Dependências Principais

O OpenClaw utiliza os seguintes pacotes do ecossistema Pi-Agent:

- **`@mariozechner/pi-agent-core` (v0.52.9)**: Core do agente, fornece tipos e interfaces fundamentais
- **`@mariozechner/pi-coding-agent` (v0.52.9)**: Gerenciamento de sessões, configurações e armazenamento
- **`@mariozechner/pi-ai` (v0.52.9)**: Integrações com LLM providers (OpenAI, Anthropic, etc.)
- **`@mariozechner/pi-tui` (v0.52.9)**: Componentes de UI de terminal

### Tipos Fundamentais

**Do Pi-Agent Core:**
- **`AgentTool`**: Interface para definir ferramentas disponíveis ao agente
- **`AgentToolResult`**: Tipo de retorno de execução de ferramenta
- **`AgentMessage`**: Estrutura de mensagem (role: "user"|"assistant"|"system", content, tool_calls, attachments)
- **`ThinkingLevel`**: Nível de raciocínio (off, low, medium, high, verbose)
- **`ReasoningLevel`**: Nível de exibição do raciocínio (hidden, default, verbose)

**Do Pi-Coding-Agent:**
- **`AgentSession`**: Objeto de sessão ativa, com métodos como `setSystemPrompt()`, `addMessages()`, `setTools()`
- **`SessionManager`**: Gerenciador de múltiplas sessões simultâneas
- **`createAgentSession()`**: Factory pattern para criar novas sessões
- **`SettingsManager`**: Gerenciamento de configurações

**Do Pi-TUI:**
- **`Component`**: Base para componentes de UI
- **`TUI`**: Interface principal do terminal
- **`SlashCommand`**: Estrutura de comandos slash

**Do Pi-AI:**
- **`ImageContent`**: Estrutura para conteúdo de imagem
- **`streamSimple()`**: Função de streaming de respostas

## 2. Sistema de Prompts (System Prompt)

### Arquivos Principais

O sistema de prompts do OpenClaw é construído dinamicamente para cada execução do agente:

- **`src/agents/system-prompt.ts`**: Contém `buildAgentSystemPrompt()` - construtor principal para agentes CLI
- **`src/agents/pi-embedded-runner/system-prompt.ts`**: Contém `buildEmbeddedSystemPrompt()` - wrapper para agentes embedded (gateway)
- **`docs/concepts/system-prompt.md`**: Documentação completa da estrutura de prompts

### Modos de Prompt

O OpenClaw suporta três modos de prompt, controlados pelo parâmetro `promptMode`:

- **`full`** (padrão): Inclui todas as seções - usado pelo agente principal
- **`minimal`**: Seções reduzidas - usado para subagentes (omite Skills, Memory, Self-Update, etc.)
- **`none`**: Apenas linha de identidade básica

### Seções do System Prompt

O prompt é composto pelas seguintes seções:

1. **Identity**: "You are a personal assistant running inside OpenClaw."
2. **Tooling**: Lista de ferramentas disponíveis com descrições curtas
3. **Safety**: Guardrails para evitar power-seeking behavior
4. **Skills** (quando disponíveis): Instruções para carregar skills sob demanda
5. **Workspace**: Diretório de trabalho atual
6. **Documentation**: Caminho para docs locais
7. **Memory Recall** (quando ferramentas disponíveis): Instruções para usar memória
8. **Messaging**: Instruções para envio de mensagens e ações de canal
9. **OpenClaw CLI Quick Reference**: Comandos do gateway
10. **OpenClaw Self-Update**: Procedimentos para self-update
11. **Model Aliases**: (quando configurados)
12. **Current Date & Time**: (quando configurado)
13. **Reply Tags**: Sintaxe de tags para respostas
14. **Voice (TTS)**: (quando configurado)
15. **Silent Replies**: Token `SILENT_REPLY_TOKEN` para respostas vazias
16. **Heartbeats**: Prompt de heartbeat e comportamento de ack
17. **Runtime**: host, OS, node, model, shell, channel, capabilities
18. **Reasoning**: Nível de raciocínio atual
19. **Sandbox**: Informações do sandbox quando habilitado
20. **Reactions**: Guias de reação por canal (minimal/extensive)
21. **Workspace Files (injected)**: Arquivos do workspace injetados como contexto

### Arquivos de Bootstrap Injetados

O OpenClaw injeta automaticamente estes arquivos do workspace no contexto do agente:

- **`AGENTS.md`**: Instruções para o agente
- **`SOUL.md`** ⭐ **ARQUIVO MAIS IMPORTANTE**: Define persona e tom do agente. Quando presente, o prompt instrui o modelo a "embody its persona and tone" - isso permite personalizar as respostas sem modificar o código principal
- **`TOOLS.md`**: Documentação de ferramentas do usuário
- **`IDENTITY.md`**: Informações de identidade da sessão
- **`USER.md`**: Informações sobre o usuário dono
- **`HEARTBEAT.md`**: Prompt de heartbeat
- **`BOOTSTRAP.md`**: Instruções iniciais (apenas em workspaces novos)
- **`MEMORY.md`** e/ou `memory/*.md`: Memória acessível via ferramentas (não injetada automaticamente)

**Nota Importante:**
- `memory/*.md` (arquivos diários) NÃO são injetados automaticamente - são acessíveis sob demanda via ferramentas `memory_search` e `memory_get`
- Arquivos são truncados se excederem `agents.defaults.bootstrapMaxChars` (padrão: 20,000 chars)
- Arquivos injetados como "Project Context" consomem tokens do modelo

### O Arquivo SOUL.md

O `SOUL.md` é o arquivo mais importante para personalização do agente. Ele define:

- **Persona**: Como o agente deve se comportar (tom, humor, nível de formalidade)
- **Tone**: Estilo de comunicação
- **Diretrizes específicas**: Comportamentos desejados

**Exemplo de estrutura do SOUL.md:**
```markdown
# Persona
Você é um assistente técnico com tom amigável e informal.

# Tone
- Seja direto e conciso
- Use humor moderado quando apropriado
- Evite jargão técnica excessiva
```

## 3. Agent Runner Architecture

### Arquivo Principal

**`src/agents/pi-embedded-runner/run/attempt.ts`**: Contém `runEmbeddedAttempt()` - ponto de entrada principal para execução do agente.

### Fluxo de Execução

```
runEmbeddedAttempt(params: EmbeddedRunAttemptParams)
    │
    ├─ 1. Preparação
    │   ├─ resolveUserPath() - resolve workspace path
    │   ├─ detectRuntimeShell() - detecta shell (bash/zsh)
    │   ├─ acquireSessionWriteLock() - lock de escrita
    │   └─ prewarmSessionFile() - aquece sessão
    │
    ├─ 2. Inicialização de Sessão
    │   ├─ prepareSessionManagerForRun() - prepara SessionManager
    │   └─ createAgentSession() - cria AgentSession via pi-coding-agent
    │       │
    │       └─ applySystemPromptOverrideToSession() - define prompt
    │
    ├─ 3. Construção de Prompt e Contexto
    │   ├─ buildSystemPromptParams() - monta parâmetros
    │   ├─ resolveSkillsPromptForRun() - carrega skills
    │   ├─ loadWorkspaceSkillEntries() - descobre skills disponíveis
    │   ├─ resolveBootstrapContextForRun() - carrega arquivos bootstrap
    │   └─ buildEmbeddedSystemPrompt() - constrói prompt completo
    │       ├─ Injeta: AGENTS.md, SOUL.md, TOOLS.md, etc.
    │       └─ Aplica: Runtime, Sandbox, Skills, Tool Policy
    │
    ├─ 4. Setup de Ferramentas
    │   ├─ createOpenClawCodingTools() - fábrica de ferramentas (pi-tools.ts)
    │   ├─ toClientToolDefinitions() - adapta para formato pi-agent-core
    │   ├─ splitSdkTools() - separa padrão vs customizadas
    │   └─ session.agent.setTools() - registra ferramentas
    │
    ├─ 5. Histórico e Compaction
    │   ├─ limitHistoryTurns() - aplica limites de história
    │   └─ sanitizeSessionHistory() - remove tool calls antigos
    │
    ├─ 6. Execução e Streaming
    │   ├─ session.start() - inicia sessão com streaming
    │   ├─ subscribeEmbeddedPiSession() - gerencia eventos
    │   │   └─ Eventos: onTurnStart, onTurnComplete, onToolCall, onToolResult, onError
    │   └─ streamSimple() - streaming de resposta
    │
    └─ 7. Finalização
        ├─ Guardar metadados da sessão
        ├─ Release de locks
        └─ Limpeza de cache
```

### Componentes Chave

**SessionManager** (pi-coding-agent):
- Gerencia múltiplas sessões ativas simultaneamente
- Fornece métodos para criar, destruir e buscar sessões por ID
- Suporta eventos de ciclo de vida das sessões

**AgentSession**:
- Representa uma sessão única de agente
- Métodos principais:
  - `setSystemPrompt(prompt)`: Define o prompt do sistema
  - `setTools(tools)`: Registra ferramentas disponíveis
  - `start(streamFn)`: Inicia execução com streaming
  - `addMessages(messages)`: Adiciona mensagens ao histórico
  - `getHistory()`: Recupera histórico da sessão

## 4. Sistema de Ferramentas (Tools)

### Arquivo Principal

**`src/agents/pi-tools.ts`**: Contém `createOpenClawCodingTools()` - fábrica principal de ferramentas.

### Categorias de Ferramentas

#### Ferramentas Padrão do Pi-Coding-Agent

Importadas de `@mariozechner/pi-coding-agent`:

- **`read`**: Ler conteúdo de arquivos
- **`write`**: Criar/sobrescrever arquivos
- **`edit`**: Edição precisa de arquivos
- **`apply_patch`**: Aplicar patches multi-arquivo
- **`grep`**: Buscar conteúdo com padrões regex
- **`find`**: Encontrar arquivos por glob pattern
- **`ls`**: Listar conteúdo de diretórios
- **`exec`**: Executar comandos shell (com suporte PTY)
- **`process`**: Gerenciar sessões de execução em background

#### Ferramentas Específicas do OpenClaw

De arquivos em `src/agents/openclaw-tools.ts`:

- **`message`**: Enviar mensagens e ações de canal
  - Parâmetros: `action` ("send"|"edit"|"unsend"|"react"), `to`, `channel`, `buttons`
  - Retorna `SILENT_REPLY_TOKEN` para resposta nativa
- **`gateway`**: Reiniciar/configurar OpenClaw
  - Comandos: `restart`, `apply`, `update`, `status`, `stop`, `start`
- **`nodes`**: Listar/descrever/notificar/câmera/nodes pareados
- **`canvas`**: Apresentar/evaluar/snapshotar Canvas
- **`image`**: Analisar imagens

#### Ferramentas de Sessão

De arquivos em `src/agents/tools/`:

- **`sessions-list`**: Listar sessões disponíveis
- **`sessions-history`**: Buscar histórico de outra sessão
- **`sessions-send`**: Enviar mensagem para outra sessão/subagente
- **`sessions-spawn`**: Criar subagente
- **`session-status`**: Mostrar status de sessão (uso, tempo, modelo)

#### Ferramentas de Canal

De arquivos em `src/agents/tools/`:

- **`whatsapp-actions.ts`**: Ações específicas do WhatsApp
- **`telegram-actions.ts`**: Ações do Telegram
- **`slack-actions.ts`**: Ações do Slack
- **`discord-actions.ts`**, `discord-actions-presence.ts`**, `discord-actions-moderation.ts`**, `discord-actions-messaging.ts`**, `discord-actions-guild.ts`**: Ações do Discord (divididas por categoria)

### Sistema de Políticas de Ferramentas

**Arquivos:**
- **`src/agents/pi-tools.policy.ts`**: Políticas principais de filtragem
- **`src/agents/tool-policy.ts`**: Resolução de políticas de grupos, plugin-only allowlists

**Funcções Principais:**
- **`filterToolsByPolicy()`**: Filtra ferramentas baseado em configurações
- **`isToolAllowedByPolicies()`**: Verifica se ferramenta é permitida
- **`resolveEffectiveToolPolicy()`**: Resolve política efetiva
- **`resolveGroupToolPolicy()`**: Política para grupos de ferramentas
- **`resolveSubagentToolPolicy()`**: Política para subagentes

### Integração com Sandbox

Arquivos em `src/agents/pi-tools.read.ts`:
- **`createSandboxedReadTool()`**: Wrapper de leitura com sandbox
- **`createSandboxedWriteTool()`**: Wrapper de escrita com sandbox
- **`createSandboxedEditTool()`**: Wrapper de edição com sandbox

Paths de sandbox configurados no `sandbox.ts`.

### Normalização de Schemas

Arquivos em `src/agents/pi-tools.schema.ts`:
- **`normalizeToolParameters()`**: Normaliza parâmetros para LLM padrão
- **`cleanToolSchemaForGemini()`**: Remove propriedades não suportadas pelo Gemini
- **`patchToolSchemaForClaudeCompatibility()**: Ajustes para Claude

### Hooks de Ferramentas

Arquivos em `src/agents/pi-tools.*.ts`:
- **`wrapToolWithAbortSignal()`**: Permite cancelar execução
- **`wrapToolWithBeforeToolCallHook()`**: Executa código antes de cada tool call

### Tool Policy

O OpenClaw permite:
- **Per-tool allowlists**: Restringir quais usuários/canais podem usar ferramentas específicas
- **Group policies**: Agrupar ferramentas por categoria (ex: ferramentas de edição só para canais específicos)
- **Subagent restrictions**: Limitar ferramentas disponíveis para subagentes
- **Elevated exec approval**: Exigir aprovação para comandos sensíveis

## 5. Sistema de Skills

### Estrutura de Diretórios

- **`.agents/skills/`**: Diretório principal de skills
- Cada skill tem seu próprio subdiretório

### Formato de Skill.md

Cada skill tem arquivo `SKILL.md`:

```markdown
# Nome da Skill
Descrição breve...

## Usage
Quando usar esta skill...

## Example
Exemplo de uso...
```

### Skills Embutidas (Bundled)

Skills embutidas no código principal do OpenClaw:
- **`mintlify/SKILL.md`**: Construção de documentação Mintlify
- **`prepare-pr/SKILL.md`**: Workflow para preparar PRs
- **`review-pr/SKILL.md`**: Análise de PRs
- **`merge-pr/SKILL.md`**: Merge de PRs
- **`pr-workflow/SKILL.md`**: Workflow completo de PR

### Carregamento de Skills

No sistema de prompts (`buildSkillsSection()`):
- Skills são listadas como metadados apenas (name, description, location)
- Não são injetadas no prompt por padrão
- O modelo usa `read <skill_location>` para carregar SKILL.md apenas quando necessário
- Mantém o prompt pequeno enquanto habilita skills direcionadas

### Integração no System Prompt

Do `src/agents/system-prompt.ts`:

```typescript
const skillsSection = [
  "## Skills (mandatory)",
  "Before replying: scan <available_skills> <description> entries.",
  "- If exactly one skill clearly applies: read its SKILL.md at <location> with `<read_tool>`, then follow it.",
  "- If multiple could apply: choose most specific one, then read/follow it.",
  "- If none clearly apply: do not read any SKILL.md.",
  "Constraints: never read more than one skill up front; only read after selecting.",
  trimmed,
  "",
];
```

Formato em prompt:
```markdown
## Skills (mandatory)
Before replying: scan <available_skills> <description> entries.
- If exactly one skill clearly applies: read its SKILL.md at <location> with `read`, then follow it.
- If multiple could apply: choose most specific one, then read/follow it.
- If none clearly apply: do not read any SKILL.md.
Constraints: never read more than one skill up front; only read after selecting.

<available_skills>
  <skill>
    <name>frontend-design</name>
    <description>Design de frontend</description>
    <location>.agents/skills/mintlify/SKILL.md</location>
  </skill>
</available_skills>
```

## 6. Gerenciamento de Sessões

### Arquivos Principais

- **`src/config/sessions/transcript.ts`**: Lógica de transcrição de sessões
- **`src/config/sessions/store.ts`**: Armazenamento de sessões
- **`src/config/sessions/types.ts`**: Tipos de sessão
- **`src/config/sessions/paths.ts`**: Paths de sessão
- **`src/agents/session-write-lock.ts`**: Lock de escrita
- **`src/agents/session-manager-cache.ts`**: Cache de SessionManager

### Formato de Arquivo de Sessão

```json
{
  "type": "session",
  "version": "1",
  "id": "session-id",
  "timestamp": "2024-02-12T10:30:00Z",
  "cwd": "/path/to/workspace"
}
<message>
{ "role": "user", "content": "..." }
<message>
{ "role": "assistant", "content": "...", "tool_calls": [...] }
</message>
...
```

**Componentes:**
- Versão: `CURRENT_SESSION_VERSION` (em session types)
- Timestamp: ISO 8601
- CWD: Diretório de trabalho atual

### Sessões CLI vs Embedded

- **CLI Session**: Sessão global única, ID armazenado em config
- **Embedded Sessions**: Múltiplas sessões ativas simultaneamente
- Cada sessão tem seu próprio arquivo JSON em `~/.openclaw/sessions/<agentId>/`

### Histórico e Compaction

**Limites:**
- `limitHistoryTurns()`: Limita número de mensagens por prompt
- `getDmHistoryLimitFromSessionKey()`: Limites específicos por provider/modelo

**Compaction:**
- Gera resumo de turnos antigos
- Resumo é persistido no arquivo de sessão
- Turnos antigos são mantidos em memória (não no prompt)

**Pruning:**
- Remove tool calls antigos do histórico em memória
- Mantém histórico completo em disco
- Reduz contexto sem perder dados importantes

### Subagentes

De `src/agents/tools/sessions-spawn-tool.ts`:
- **`sessions_spawn`**: Cria nova sessão (subagente)
- Subagentes usam `promptMode = "minimal"` (contexto reduzido)
- Skills são filtradas (sem Skills, Memory, etc.)

## 7. Integração TUI (Terminal UI)

### Arquivos Principais

- **`src/tui/`**: Diretório principal de TUI
- Componentes do pi-tui utilizados

### Tipos do Pi-TUI

```typescript
type Component = {
  render(): string;
}

type TUI = {
  add(component: Component): void;
  remove(component: Component): void;
  setRoot(component: Component): void;
}
```

### Componentes Específicos

**`Container`**: Layout de containers
**`Markdown`**: Renderização de Markdown
**`Text`**: Texto simples
**`Spacer`**: Espaçamento
**`Editor`**: Editor de texto
**`SelectList`, `SettingsList`**: Listas selecionáveis
**`FilterableSelectList`**: Listas com filtros

### Mensagens

**`src/tui/components/user-message.ts`**: Mensagens do usuário
**`src/tui/components/assistant-message.ts`**: Mensagens do assistente
**`src/tui/components/chat-log.ts`**: Log de conversa

### Event Handling

**`src/tui/tui-event-handlers.ts`**: Gerencia eventos de TUI
**`src/tui/tui-command-handlers.ts`**: Gerencia comandos
**`src/tui/tui-local-shell.ts`**: Shell local dentro de TUI

## 8. Sistema de Auto-Reply e Roteamento

### Arquivos Principais

- **`src/auto-reply/`**: Lógica de auto-reply
- **`src/routing/`**: Roteamento de mensagens
- **`src/channels/`**: Integrações com canais

### Fluxo de Mensagem

```
Usuário envia mensagem
    ↓
[Canal: Telegram/Discord/Slack/WhatsApp/Signal/iMessage]
    ↓
[Auto-reply System]
    (Verifica allowlist, thinking mode, comandos)
    ↓
    [Agent Session Selecionada]
        (Baseado em allowlist, canal atual, carga)
        ↓
        [System Prompt Aplicado]
            (Constrói prompt dinâmico)
            ↓
            [Agent Executa]
                (Processa, usa ferramentas, gera resposta)
                    ↓
                    [Resposta Enviada ao Usuário]
                        ↓
                    [Canal envia resposta original]
```

### Thinking Modes

Configuráveis por `agents.defaults.thinkLevel`:
- **`off`**: Raciocínio desativado
- **`low`**: Raciocínio mínimo (para tasks simples)
- **`medium`**: Raciocínio médio (padrão)
- **`high`**: Raciocínio alto (para problemas complexos)
- **`verbose`**: Raciocínio detalhado (para debugging/analysis)
- **`xhigh`**: Raciocínio extremo (requer suporte do provider)

### Capacidades de Canal

De `src/config/channel-capabilities.ts`:
- **Inline buttons**: Suporte a botões em mensagens
- **Reactions**: Níveis de reação (minimal/extensive)
- **Message actions**: react, edit, unsend, etc.
- **Media support**: Imagens, áudio, arquivos

### Comandos de Controle

Comandos disponíveis (stripped antes do modelo):
- `/agent`: Habilita/desabilita agente
- `/verbose`: Habilita/desabilita raciocínio detalhado
- `/reasoning`: Alterna visibilidade do raciocínio
- `/elevated`: Aprovação de execução elevada
- `/model`: Muda modelo
- `/queue`: Lista fila de mensagens
- `/context`: Inspeção de contexto

## 9. Extensões e Plugins

### Descoberta de Extensões

O OpenClaw escaneia o diretório `extensions/`:
- Lê `openclaw.plugin.json` em cada subdiretório
- Descobre skills, ferramentas e handlers

### Estrutura de Plugin

```json
{
  "name": "nome-do-plugin",
  "version": "1.0.0",
  "skills": [],
  "tools": [],
  "handlers": {}
}
```

### Integração de Ferramentas de Plugin

De `src/plugins/tools.js`:
- **`getPluginToolMeta()`**: Obtém metadados de ferramenta de plugin
- **`listChannelAgentTools()`**: Lista ferramentas de canais de plugins
- Ferramentas de plugins são mescladas com ferramentas principais

### Plugins de Canal

Exemplos:
- `extensions/whatsapp/`: Plugin de WhatsApp
- `extensions/discord/`: Plugin de Discord
- `extensions/slack/`: Plugin de Slack
- `extensions/signal/`: Plugin de Signal
- `extensions/matrix/`: Plugin de Matrix

Cada plugin de canal:
- Implementa handlers de mensagens
- Fornece ferramentas específicas do canal
- Registra capacidades no sistema

## 10. Fluxo de Dados Completo

```
Usuário envia mensagem pelo canal
    ↓
[Recebimento de Mensagem]
    (gateway ou webhook do canal)
        ↓
[Verificação de Auto-reply]
    (auto-reply/ routing)
    - Verifica allowlist: usuário pode usar agente?
    - Verifica comandos: /agent habilitado?
    - Verifica thinking mode
    - Verifica mention gating
    ↓
[Seleção de Sessão/Agente]
    (Baseado em canal, usuário, configurações)
    - Se CLI: usa sessão global
    - Se embedded: cria nova sessão ou usa existente
    ↓
[Construção do System Prompt]
    (system-prompt.ts + pi-embedded-runner/system-prompt.ts)
    - Resolve workspace path
    - Carrega skills disponíveis (loadWorkspaceSkillEntries)
    - Carrega arquivos de bootstrap (AGENTS.md, SOUL.md, etc.)
    - Define ferramentas disponíveis (tool policy)
    - Injeta SOUL.md (se presente)
    - Aplica configurações de sandbox
    - Constrói Runtime info (host, OS, model, etc.)
    ↓
[Criação de AgentSession]
    (pi-coding-agent: SessionManager → AgentSession)
    - Registra hooks (onTurnStart, onTurnComplete, onToolCall, onError)
    - Define sistema de streaming
    - Aplica histórico e compaction
    ↓
[Setup de Ferramentas]
    (pi-tools.ts)
    - Cria ferramentas padrão (read, write, edit, grep, ls, exec)
    - Cria ferramentas OpenClaw (message, gateway, nodes, canvas, image)
    - Cria ferramentas de canal (telegram-actions, discord-actions, etc.)
    - Cria ferramentas de sessão (sessions-list, sessions-spawn, etc.)
    - Aplica filtros de política (allowlists, group policies, subagent policies)
    - Normaliza schemas para provider específico
    - Registra no AgentSession
    ↓
[Início da Execução]
    (session.start())
    - Subscreve eventos (onTurnStart, onTurnComplete, onToolCall, onToolResult, onError)
    - Define função de streaming (streamSimple)
    ↓
[Processamento de Mensagem]
    (Loop de eventos do pi-agent)
    - onTurnStart: Inicia novo turno
    - Agente processa, gera tool calls
    - onToolCall: Captura tool calls para logging
    - onTurnComplete: Turno finalizado, streaming pronto
    - onError: Erro na execução
    ↓
[Geração de Resposta]
    - Agente processa, chama ferramentas
    - Resposta é gerada via streamSimple()
    ↓
[Envio de Resposta ao Usuário]
    (via canal original ou ferramenta message com channel específico)
    - Mensagem original é enviada
```

## 11. Como Usar o Framework Pi-Agent no Seu Projeto

### Passo 1: Configurar Dependências

```bash
pnpm install
```

Adicionar ao `package.json`:
```json
{
  "dependencies": {
    "@mariozechner/pi-agent-core": "0.52.9",
    "@mariozechner/pi-ai": "0.52.9",
    "@mariozechner/pi-coding-agent": "0.52.9",
    "@mariozechner/pi-tui": "0.52.9"
  }
}
```

### Passo 2: Criar Agente Básico

```typescript
import { createAgentSession } from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";

// Definir ferramentas
const tools: AgentTool[] = [
  {
    name: "meu_tool",
    description: "Descrição da ferramenta",
    parameters: {
      type: "object",
      properties: {
        parametro: {
          type: "string",
          description: "Descrição do parâmetro"
        }
      }
    }
  }
];

// Criar sessão
const session = createAgentSession({
  systemPrompt: "You are a helpful assistant...",
  tools,
});

// Iniciar execução
await session.start((message) => {
  console.log("Message:", message);
  // Processar mensagem e gerar resposta
});
```

### Passo 3: Personalizar com SOUL.md

Criar arquivo `SOUL.md` no diretório de trabalho:
```markdown
# Persona
Você é um assistente técnico focado em [tema].

# Tone
- Seja [característica 1]
- Evite [característica 2]

# Diretrizes
- Sempre [comportamento 1]
- Nunca [comportamento 2]
```

### Passo 4: Criar Skill

Criar diretório e `SKILL.md`:
```markdown
# Nome da Skill
Descrição breve...

## Usage
Quando usar esta skill...

## Example
Exemplo prático...
```

### Passo 5: Integrar com TUI (opcional)

```typescript
import type { TUI, Container, Markdown } from "@mariozechner/pi-tui";

const tui: TUI = /* obter instância do TUI */;

tui.setRoot(
  new Container({
    children: [
      new Markdown({ text: "Olá! Como posso ajudar?" }),
    ],
  })
);
```

## 12. Padrões e Convenções

### TypeScript
- **ESM Strict**: Usar ESM, import com `.js` extensions
- **Tipos Explícitos**: Evitar `any`, usar tipos de pi-agent
- **Async/Await**: Usar `async/await` para operações assíncronas

### Nomenclatura
- **camelCase** para funções e variáveis
- **PascalCase** para tipos e classes
- **SCREAMING_SNAKE_CASE** para constantes
- Prefixo `_` para membros privados

### Segurança
- Nunca expor credenciais em código
- Validar inputs de ferramentas
- Usar sandboxing quando disponível
- Aplicar políticas de ferramentas

### Documentação
- Documentar funções públicas com JSDoc
- Adicionar exemplos de uso
- Manter README atualizado

## 13. Recursos e Documentação

### Repositório Oficial
- GitHub: https://github.com/openclaw/openclaw
- Documentação: https://docs.openclaw.ai
- Comunidade: https://discord.com/invite/clawd

### Documentação Técnica do Pi-Agent
Consultar documentação do Mario Zechner para detalhes específicos do framework.

### Skills Hub
Descobrir e reutilizar skills em: https://clawhub.com

## Conclusão

O OpenClaw demonstra uma arquitetura robusta e extensível usando o framework Pi-Agent. A integração entre componentes de sessão, sistema de prompts dinâmico, ferramentas flexíveis e canais múltiplos cria uma plataforma poderosa para desenvolvimento de aplicações de IA.

**Principais pontos da arquitetura:**
1. Separação clara entre core (Pi-Agent) e domínio (OpenClaw)
2. Sistema de prompts extensível com injeção dinâmica de contexto
3. Arquivo SOUL.md como mecanismo de personalização
4. Sistema de ferramentas com políticas granulares
5. Skills sob demanda para manter prompts pequenos
6. Suporte a múltiplos provedores LLM
7. Sandbox e hooks para extensão segura
8. TUI integrável para interfaces de terminal
9. Roteamento inteligente entre canais e agentes
10. Compaction e pruning para gerenciar contexto de longo prazo
