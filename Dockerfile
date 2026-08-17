# PianoBE 后端镜像（多阶段）：Docker 内构建 core/web 产物，运行时只装生产依赖。
# 上下文 = monorepo 根目录（docker compose context: .）

# ---- 构建阶段 ----
FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY . .
# 容器内仅 core/server/web（.dockerignore 排除 addon/generator），装全量依赖
RUN bun install
RUN bun run --filter @piano/core build
RUN bun run --filter @piano/web build

# ---- 运行阶段 ----
FROM oven/bun:1-alpine AS runtime
WORKDIR /app

# 拷贝运行所需（源码 + builder 构建产物）
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/server/src packages/server/src
COPY --from=builder /app/packages/server/package.json packages/server/
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/web/dist packages/web/dist

# 只装 server 运行时依赖（hono + @piano/core）。不带 lockfile，production 全新解析
RUN bun install --production --no-save --filter @piano/server

WORKDIR /app/packages/server
ENV PORT=3000 DB_PATH=/app/data/piano.db MIDIS_DIR=/app/data/midis WEB_ROOT=/app/packages/web/dist
VOLUME /app/data
CMD ["bun", "src/index.ts"]
