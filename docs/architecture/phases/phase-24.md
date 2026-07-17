# Arquitetura - Fase 24 (Media Investigation Team)

Status: em andamento

## Objetivo

Transformar evidencias deterministicas produzidas pelo VHS em uma investigacao
visivel, persistente e evolutiva, conduzida por perfis especialistas do Kael.

## Fronteira arquitetural

- VHS continua sem agentes, prompts, sessoes ou LLM:
  - coleta e normaliza fatos;
  - executa `probe` e `analyze`;
  - produz issues, entries e summaries deterministas.
- Kael e dono da investigacao:
  - persiste o evidence bundle;
  - executa perfis especialistas;
  - versiona e fotografa prompts;
  - sintetiza consenso, divergencias e proximos testes;
  - expoe API, tool PI e UI.

## Runtime de agentes

Nao existe uma segunda implementacao PI. O agente principal e os especialistas
usam a mesma instancia de `PiAgentRuntime`, compartilhando provider, modelo,
autenticacao e bridge do SDK.

Cada especialista recebe um contexto isolado porque precisa de:

- system prompt proprio;
- execucao paralela sem contaminacao da conversa principal;
- output independente e auditavel;
- reexecucao sobre a mesma evidencia para comparar versoes de prompt.

O agente principal usa a tool `media_investigate` para iniciar/listar/consultar ou
reexecutar investigacoes.

## Equipe inicial

1. `Timeline & Container`: PTS/DTS, boundaries, GOP, keyframes e container.
2. `Audio & Video`: continuidade A/V, codecs e qualidade observavel.
3. `Manifest & Delivery`: manifesto versus midia, ladder e publicacao.
4. `Lead Investigator`: investiga ativamente, adquire novas evidencias e sintetiza a conclusao.

Os tres especialistas executam em paralelo sobre o baseline. O Lead Investigator
inicia depois que pelo menos um especialista conclui e recebe uma allowlist de tools
read-only para testar hipoteses levantadas pelo `problemStatement`.

## Investigacao ativa

Cada run persiste o problema relatado e contexto opcional (tempo aproximado, track,
player, reproducibilidade e comportamento esperado). O relato orienta prioridades,
mas nao e tratado como ground truth.

O Lead pode executar ate 8 checks por run:

- `media_manifest_inspect`;
- `media_freeze_detect`;
- `media_black_detect`;
- `media_silence_detect`;
- `media_decode_validate`.

As tools operam somente sobre o origin clonado, nao aceitam paths ou argumentos
arbitrarios e nao produzem arquivos. Content QA executa FFmpeg com timeout; a
inspecao HLS le manifests locais e retorna, por playlist e segmento, media sequence,
discontinuity sequence, tags imediatamente anteriores e a presenca exata de
`EXT-X-DISCONTINUITY`.
Cada chamada persiste motivo, parametros, estado, duracao e evidence IDs. Eventos
de freeze adjacentes separados apenas por uma boundary HLS sao unidos.

Quando o baseline encontra reset de PTS ou mudanca de source, codec, sample rate
ou init segment, o Lead deve consultar o primeiro segmento depois da transicao.
A conclusao `missing_hls_discontinuity_tag` exige a correlacao entre a anomalia de
midia e `hasDiscontinuityBefore=false` no mesmo boundary; a ausencia da tag nao e
inferida apenas a partir dos timestamps.

## Raciocinio causal e evidencias derivadas

O bundle inclui `derived.avOffsetSeries`, calculado deterministicamente a partir
dos primeiros PTS de audio e video de cada segmento. Cada serie preserva o sinal
`audio PTS - video PTS` e classifica o padrao como `aligned`, `constant_offset`,
`drift`, `discontinuity`, `variable` ou `insufficient`.

Essa camada nao atribui causa upstream. Ela torna explicito o padrao temporal que
os perfis precisam explicar e evita depender do LLM para refazer aritmetica basica.
Inicialmente o calculo vive no modulo de investigacao; deve migrar para um contrato
publico do VHS quando o `MediaEvidenceBundle` for promovido para aquele pacote.

Os outputs de hipotese registram:

- evidencias explicadas, contraditorias e ainda sem explicacao;
- observacoes previstas e cadeia causal;
- etapa provavel separada do fato observado.

O Lead Investigator ranqueia hipoteses concorrentes e recebe cobertura de evidencia
recalculada pelo runtime. Confianca alta e limitada quando faltam citacoes, existem
contradicoes ou findings dos especialistas ficam sem explicacao.

## Persistencia e prompts

- Investigacoes: `<KAEL_DATA_DIR>/media-investigations/<id>.json`.
- Prompts editaveis: `.kael/agents/media-investigation/*.md`.
- Cada run persiste conteudo completo, versao, SHA-256 abreviado, modelo, duracao,
  output estruturado, tool trail, evidencias adquiridas e erro.
- `rerun` cria nova investigacao e mantem `sourceInvestigationId`, sem alterar o
  historico anterior.

## Superficies

- API `/media-investigations`.
- Tool PI `media_investigate`.
- UI `/investigations` e `/investigations/:investigationId`.

## Proximos incrementos

1. Promover output deterministico do VHS para um `MediaEvidenceBundle` publico e versionado.
2. Adicionar extracao de frames/waveform e um escape hatch FFmpeg restrito para checks ainda nao tipados.
3. Expandir o caso deterministico `tc_001_audio_delayed` para um runner de eval real dos prompts e outros fixtures com ground truth.
4. Avaliar reconsulta dos especialistas depois que o Lead adquirir evidencias novas.
5. Expor custo/tokens por agent run quando o SDK fornecer essa telemetria de forma estavel.
