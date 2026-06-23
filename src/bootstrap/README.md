# Bootstrap

Fabrica de runtimes do Kael. Modulo responsavel por instanciar e conectar todos os servicos do sistema a partir da configuracao centralizada (`KaelConfig`).

## Arquitetura

```
                        KaelConfig
                            |
                            v
          +-----------------------------------+
          |       bootstrap/runtime.ts         |
          |     (fabrica de runtimes)          |
          +-----------------------------------+
                            |
      +--------+--------+---+---+--------+--------+--------+
      |        |        |   |   |        |        |        |
      v        v        v   v   v        v        v        v
  +-------+ +-----+ +----+ +--+ +------+ +--------+ +----+ +------+
  | Video | |Shell| |MCP| |Mem| |Worksp| |Browser | |Re- | |Plan- |
  |       | |     | |    | |   | |ace   | |        | |search|ner  |
  +---+---+ +-----+ +----+ +-+-+ +------+ +--------+ +----+ +------+
      |                     |
      v                     v
  +-------+            +--------+
  |Media  |            |KaelApp |
  +-------+            +--------+
```

## Funcoes de fabrica

### `createVideoRuntime(config, jobStore)`

Instancia a pipeline de vídeo: jobs e artefatos do Kael, mais as operações
determinísticas fornecidas por `@gugaio/vhs`.

**Retorno:**
| Campo | Tipo | Responsabilidade |
|-------|------|------------------|
| `jobs` | `JobService` | Fila e lifecycle genérico de jobs (usa `ProcessSupervisor`) |
| `videoJobs` | `createVideoJobs()` | Validação e comandos ffmpeg/ffprobe/VLC |
| `videoInspect` | `MediaInspector` (VHS) | Probe/inspeção de mídia e HLS |
| `manifestAudit` | `ManifestAudit` (VHS) | Auditoria de manifests HLS |
| `manifestDiff` | `ManifestDiff` (VHS) | Diff entre dois audits HLS |
| `mediaArtifacts` | `MediaArtifactsService` | Persistência de artifacts de imagem/vídeo |

**Cadeia de dependencias:**
```
LocalProcessRunner -> ProcessSupervisor -> JobService <- createVideoJobs
VHS MediaInspector -> ManifestAudit -> ManifestDiff
MediaArtifactsService (init cria diretorio)
```

```typescript
const { jobs, manifestAudit } = await createVideoRuntime(config, jobStore);
```

### `createShellRuntime(config)`

Instancia o servico de execucao de shell com sandbox e aprovacoes.

**Dependencias:** `resolveKaelHome()` para path de aprovacoes.

```typescript
const shell = await createShellRuntime(config);
```

### `createMcpRuntime(config)`

Instancia a ponte MCP (Model Context Protocol) para integracao com ferramentas externas.

**Dependencias:** diretorio `dataDir/mcp/` para registry e aprovacoes.

```typescript
const mcp = await createMcpRuntime(config);
```

### `createMemoryRuntime(config)`

Instancia o servico de memoria persistente com recuperacao hibrida.

**Dependencias:** `resolveKaelHome()/data/memory/` para storage, `HybridMemoryRetriever` para busca.

```typescript
const memory = await createMemoryRuntime(config);
```

### `createWorkspaceRuntime(config)`

Instancia o inspetor de workspace para leitura e busca de arquivos.

```typescript
const workspace = createWorkspaceRuntime(config);
```

### `createBrowserRuntime(config)`

Instancia o runtime de browser para automacao web via Playwright.

```typescript
const browser = createBrowserRuntime(config);
```

### `createResearchRuntime(config)`

Instancia o servico de pesquisa com suporte a Tavily Search ou provider desabilitado.

```typescript
const research = createResearchRuntime(config);
```

### `createPlannerRuntime(config)`

Instancia o servico de planejamento com geracao de planos via LLM.

```typescript
const planner = await createPlannerRuntime(config);
```

### `createMediaRuntime(config, videoArtifacts)`

Instancia os servicos de midia: compreensao de imagem/audio, geracao de imagens e geracao de video.

**Retorno:**
| Campo | Tipo | Responsabilidade |
|-------|------|------------------|
| `mediaUnderstanding` | `MediaUnderstandingService` | Analise de imagem/audio via OpenAI |
| `imageGenerator` | `ImageGeneratorService` | Geracao de imagens |
| `videoGeneration` | `ProviderBackedMediaGenerationService` | Geração de mídia usando imageGenerator + artifacts |

**Fallback:** Se `media.enabled=false` ou sem API key, usa implementacoes `Noop*`.

```typescript
const { mediaUnderstanding, imageGenerator } = createMediaRuntime(config, videoArtifacts);
```

## Integracao

Todas as funcoes de fabrica sao consumidas pelo `KaelApp` para montar o runtime completo:

```typescript
const app = new KaelApp(config);
await app.init();
// app.engine tem acesso a todos os runtimes via tools
```

## Convencao

- Cada funcao recebe `KaelConfig` e retorna o(s) servico(s) prontos para uso.
- Funcoes assincronas (`async`) executam `init()` e garantem que diretorios/recursos existam.
- Paths sao sempre derivados de `config.dataDir` ou `resolveKaelHome()`.
