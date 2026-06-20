# Video capability in Kael

Kael owns agent-specific video concerns only:

- jobs de `ffmpeg`/`ffprobe`/VLC, com fila, logs e politicas de paths;
- geração e persistência de artifacts;
- adaptação de watches HLS para `sessionKey` do agente.

Operações determinísticas de mídia não vivem neste diretório. O Kael consome
`@gugaio/vhs` para inspect, manifest audit/diff, clone HLS/DASH, origins locais,
monitoramento HLS e triagem de playback.

```text
Kael tools / API / CLI
        |
        +-- jobs e artifacts locais
        |
        +-- @gugaio/vhs
              inspect | manifest | stream | watch | playback
```

O Kael preserva autorização, telemetria e contexto de sessão. VHS não conhece
agentes, jobs, memória ou MCP.
