# Deploy com Docker (primeiro incremento)

Este compose executa a API do Kael em um container com Node 22, `ffmpeg` e
`ffprobe`. Ele persiste estado em um volume Docker e deixa a porta HTTP ligada
somente ao loopback da VPS. Ainda nao e a camada de exposicao publica: Caddy e
UI entram no proximo incremento.

## Pre-requisitos

- Docker Engine com Docker Compose v2;
- acesso de rede ao GitHub durante o build, para baixar o VHS fixado por commit;
- uma chave de API configurada se `KAEL_ENGINE_MODE=pi` ou `hybrid`.

## Subida inicial

```bash
cp .env.example .env
mkdir -p workspace
# Edite .env e defina KAEL_API_AUTH_TOKEN e KAEL_PI_API_KEY.
docker compose up -d --build
docker compose ps
```

O estado persistente fica no volume `kael-data`; arquivos que o agente pode
operar ficam em `./workspace`. Configure `KAEL_UID` e `KAEL_GID` com o UID/GID
do dono desse diretorio na VPS (em geral `1000`).

## Acesso inicial seguro

A porta e publicada apenas em `127.0.0.1:3210`. Use um tunel SSH para abrir a
UI/API localmente enquanto Caddy ainda nao foi configurado:

```bash
ssh -L 3210:127.0.0.1:3210 user@vps
```

Todas as rotas, inclusive `/health`, exigem o header Bearer quando
`KAEL_API_AUTH_TOKEN` estiver configurado:

```bash
curl -H "Authorization: Bearer $KAEL_API_AUTH_TOKEN" http://127.0.0.1:3210/health
```

## Operacao

```bash
docker compose logs -f kael
docker compose restart kael
docker compose down
```

`docker compose down` nao remove o volume de dados. So use
`docker compose down -v` se quiser apagar permanentemente sessoes, jobs,
artifacts e dados de streamer.

## Limites deste incremento

- Nenhuma porta e exposta publicamente; o proximo passo e Caddy com TLS e UI.
- `stream_serve` ainda abre um servidor temporario em loopback e nao gera URL
  publica; a integracao dele ao servidor principal e um incremento separado.
