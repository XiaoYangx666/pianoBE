# ---- 构建阶段 ----
FROM oven/bun:1 AS build
WORKDIR /app

# 整个 monorepo（.dockerignore 已排除 node_modules/midis 等重目录）
COPY . .

# 安装全部 workspace 依赖（file: 依赖均已 vendored 在仓库内）
RUN bun install

# 构建共享库与前端管理页
RUN bun run --filter @piano/core build
RUN bun run --filter @piano/web build

# ---- 运行阶段 ----
FROM oven/bun:1-slim AS runtime
WORKDIR /app/apps/server

COPY --from=build /app /app

ENV PORT=3000 \
    DB_PATH=/app/data/piano.db \
    WEB_ROOT=/app/apps/web/dist

EXPOSE 3000
VOLUME /app/data

CMD ["bun", "src/index.ts"]