# Youbora (NPAW)

Este documento descreve **como o ecossistema do projeto usa o Youbora/NPAW** para métricas de playback e contexto de device/app.

> Nota: o **runtime do Kael** hoje inclui uma **skill operacional** para consultar a API do Youbora (NPAW) via MD5 token. A **instrumentação do SDK v6** (em apps/players) é parte do produto (fora deste repo), mas os **campos/dimensões** abaixo refletem o que queremos/estamos enviando.

## 1) O que é (pra nós)

- **Youbora/NPAW** = plataforma de **métricas/QoE** (views/plays/errors, qualidade, buffering, etc.).
- **SDK em uso nos apps/players**: **Youbora SDK v6** (conforme definição do produto).

## 2) Dados que enviamos (alto nível)

### 2.1 Device / ambiente
Campos típicos (exemplos):
- `device.model`
- `device.brand`

### 2.2 Sessão / playback
Campos típicos (exemplos):
- `url` (URL do conteúdo/manifest, quando aplicável)
- `city` (cidade inferida/fornecida)

### 2.3 Dimensões customizadas (nossas)
Além do baseline do Youbora, enviamos **custom dimensions** para segmentação de produto.

#### `player_type`
- Objetivo: segmentar métricas por **tipo de player** (ex.: web, android, tv, etc. — taxonomia a definir no app).

#### `video_kind`
- Objetivo: segmentar por **tipo de vídeo**.
- Valores acordados:
  - `episodio`
  - `trailer`
  - `integra`
  - `short`

### 2.4 Tabela de mapeamento (recomendado)
Definir explicitamente como cada dimensão do produto vira campo no Youbora SDK v6.

| Conceito do produto | Campo no Youbora | Exemplo | Fonte |
|---|---|---|---|
| Tipo de player | `player_type` (custom) | `web` | app/player |
| Tipo de vídeo | `video_kind` (custom) | `episodio` | app/player |
| Marca do device | `device.brand` | `Samsung` | device |
| Modelo do device | `device.model` | `SM-G991B` | device |
| URL | `url` | `https://…/master.m3u8` | player |
| Cidade | `city` | `Rio de Janeiro` | geo/IP/app |

> TODO: preencher nomes exatos das chaves no SDK v6 (ex.: custom dimension #, key string, etc.) quando tivermos o trecho de instrumentação do player/app.

## 3) Como o Kael consulta Youbora hoje (operacional)

O Kael tem uma **skill `youbora`** para consultas agregadas na API (NPAW), preferindo **Clark/MCP** quando disponível.

Evidências no repo:
- A skill existe em `.kael/skills/youbora/SKILL.md` e declara o fluxo (priorizar `youbora_metrics_get`, fallback em script local) — ver `SKILL.md` (linhas 1–40).
- O fallback local usa um script que monta URL assinada com **MD5** e retorna JSON estruturado — ver `.kael/skills/youbora/scripts/query-youbora.mjs` (linhas 1–110).

### 3.1 Variáveis de ambiente
A skill espera:
- `KAEL_YOUBORA_HOST` (default recomendado: `https://api.npaw.com`)
- `KAEL_YOUBORA_ACCOUNT_CODE`
- `KAEL_YOUBORA_API_KEY`
- `KAEL_YOUBORA_DATE_TOKEN_TTL_MS` (opcional)

> Segurança: não hardcodar credenciais em docs/código. A `API_KEY` nunca deve aparecer em texto plano.

### 3.2 Exemplos de uso (Kael)
Conforme o guia da skill:
- `/youbora last24hours`
- `/youbora "2025-03-20 00:00:00" "2025-03-20 17:50:25" views vod hour`

## 4) Próximos passos (para fechar o ciclo SDK v6 → consulta)

1. **Anexar evidência do SDK v6**: colar aqui um snippet de instrumentação (web/android/tv) mostrando onde setamos:
   - `device.brand/model` (se manual)
   - `url`
   - `city`
   - `player_type` (custom)
   - `video_kind` (custom)
2. **Congelar taxonomia** de `player_type` (lista de valores) e de `video_kind` (já definida acima).
3. (Opcional) Criar um contrato interno/JSON schema para padronizar dimensões antes de enviar ao Youbora.
