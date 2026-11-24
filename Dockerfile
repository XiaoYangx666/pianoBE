# PianoBE 后端镜像（多阶段）：Docker 内构建 core/web 产物，运行时只装生产依赖。
# 上下文 = monorepo 根目录（docker compose context: .）

# ---- 构建阶段 ----
FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY . .
# 保证 packages/server/amt 存在：没有同步 AMT 时镜像仍可构建（运行时报告 AMT 不可用）
RUN mkdir -p packages/server/amt
# 容器内仅 core/server/web（.dockerignore 排除除采样外的 addon 与 generator），装全量依赖
RUN bun install
RUN bun run --filter @piano/core build
RUN bun run --filter @piano/vfx build
RUN bun run --filter @piano/plugins build
RUN bun run --filter @piano/assembly build
RUN bun run pack:plugins
RUN bun run --filter @piano/studio build

# ---- 运行阶段 ----
# 用 Debian（glibc）而不是 Alpine：AMT 官方的 amt-cli / libonnxruntime.so 是 glibc 构建
FROM oven/bun:1-slim AS runtime
WORKDIR /app

# amt-cli 与 ONNX Runtime 需要的 C++ / OpenMP 运行库
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# 拷贝运行所需（源码 + builder 构建产物 + 已同步的 Linux 版 AMT）
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/server/src packages/server/src
COPY --from=builder /app/packages/server/package.json packages/server/
COPY --from=builder /app/packages/server/amt packages/server/amt
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/vfx/dist packages/vfx/dist
COPY --from=builder /app/packages/vfx/package.json packages/vfx/
COPY --from=builder /app/packages/assembly/dist packages/assembly/dist
COPY --from=builder /app/packages/assembly/package.json packages/assembly/
COPY --from=builder /app/packages/studio/dist packages/studio/dist
COPY --from=builder /app/build/plugins build/plugins

# 交叉准备（Windows 主机）时不带无版本号的 .so 链接，这里补上
RUN cd packages/server/amt \
    && if [ ! -e libonnxruntime.so ] && ls libonnxruntime.so.* >/dev/null 2>&1; then \
        ln -s "$(ls libonnxruntime.so.* | head -n 1)" libonnxruntime.so; \
    fi

# 只装 server 运行时依赖（hono + @piano/core）。不带 lockfile，production 全新解析
RUN bun install --production --no-save --filter @piano/server

WORKDIR /app/packages/server
ENV PORT=3000 DB_PATH=/app/data/piano.db MIDIS_DIR=/app/data/midis LOG_FILE=/app/data/logs/server.log WEB_ROOT=/app/packages/studio/dist BUILTIN_PLUGINS_DIR=/app/build/plugins
VOLUME /app/data
CMD ["bun", "src/index.ts"]
