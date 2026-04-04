# Playbook de Analise - hls.js

## Perguntas que devem guiar a resposta

1. O usuario quer manter defaults ou justificar overrides?
2. O stream e `live` ou `vod`?
3. O objetivo principal e:
   - latencia baixa
   - estabilidade
   - startup rapido
   - equilibrio geral
4. Existem sintomas observados?
   - stalls
   - startup lento
   - memoria alta
   - atraso excessivo de live
5. Existe device/restricao clara?
   - TV
   - set-top box
   - mobile
   - desktop
6. A configuracao esta usando defaults, overrides parciais ou tuning pesado?
7. A familia de live tuning usada e:
   - por contagem de segmentos
   - por duracao em segundos

## Padrao de julgamento

### Caso 1: usuario sem sintomas claros

- favoreca defaults;
- explique que tuning sem contexto costuma piorar previsibilidade.
- se houver poucos overrides, avalie se eles realmente trazem ganho ou so desviam do baseline oficial.

### Caso 2: live com foco em latencia

- revise parametros de live edge e buffer frontal;
- explique claramente que menos latencia quase sempre reduz folga.

### Caso 3: stalls/rebuffer

- nao presuma que o problema e so tuning;
- cite manifest, ladder, rede e origem como causas possiveis;
- se ainda assim sugerir tuning, faca poucas mudancas por vez.
- quando houver live, considere tambem se o alvo de sync esta agressivo demais.

### Caso 4: memoria/dispositivo fraco

- revise `backBufferLength` e `maxBufferSize`;
- prefira recomendacoes conservadoras e justificadas.

### Caso 5: startup ruim

- revise `startLevel` e o custo de carregar niveis altos cedo demais;
- diferencie startup lento de problema estrutural de rede/origem.

## Checklist rapido antes de recomendar override

- O default oficial do parametro e conhecido?
- Existe tradeoff oficial claro para esse parametro?
- Ha contexto suficiente para dizer que o default nao basta?
- O parametro conflita com outro campo configurado?
- A recomendacao proposta muda um comportamento principal ou so mascara um sintoma?

## Formato de recomendacao ideal

- `manter`
  - o que esta bom ou deveria continuar no default
- `ajustar`
  - no maximo 1-3 parametros relevantes
- `nao concluir ainda`
  - o que exige mais contexto
- `teste sugerido`
  - uma mudanca por vez, com expectativa clara

## Coleta minima de contexto quando o usuario trouxer config incompleta

Se faltar contexto, pedir ou inferir cuidadosamente:

- `live` ou `vod`
- objetivo principal
- sintomas observados
- device class
- trechos de config realmente sobrescritos
- se ha manifest/telemetria/logs corroborando o problema

Sem isso, a recomendacao default deve ser conservadora.
