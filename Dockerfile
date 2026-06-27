FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl tini util-linux \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 kael \
  && useradd --uid 10001 --gid kael --create-home --home-dir /home/kael --shell /usr/sbin/nologin kael

WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /data /workspace \
  && chown -R kael:kael /data /workspace /home/kael

ENV NODE_ENV=production \
  KAEL_HOST=0.0.0.0 \
  KAEL_PORT=3210 \
  KAEL_DATA_DIR=/data \
  KAEL_EXEC_WORKSPACE_ROOT=/workspace \
  KAEL_ALLOWED_PATHS=/workspace,/data,/tmp

EXPOSE 3210
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/cli/index.js", "server"]
