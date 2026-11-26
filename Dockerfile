# PianoBE 后端镜像（多阶段）：Docker 内构建 core/web 产物，运行时只装生产依赖。
# 上下文 = monorepo 根目录（docker compose context: .）

# ---- 构建阶段 ----
FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY . .
# 容器内仅 core/server/web（.dockerignore 排除除采样外的 addon 与 generator），装全量依赖
# 缓存下载的 tarball：amt-cli 主包 + 当前平台包约 17 MB，重建时不重复下载
RUN --mount=type=cache,target=/root/.bun/install/cache bun install
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
# deb.debian.org / 阿里云在这台构建机上要么极慢要么连不通，默认用南大镜像；
# 海外构建可传 --build-arg DEBIAN_MIRROR=https://deb.debian.org
ARG DEBIAN_MIRROR=https://mirror.nju.edu.cn
RUN if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i -E "s#https?://deb\.debian\.org#${DEBIAN_MIRROR}#g" /etc/apt/sources.list.d/debian.sources; \
    fi \
    && if [ -f /etc/apt/sources.list ]; then \
        sed -i -E "s#https?://deb\.debian\.org#${DEBIAN_MIRROR}#g" /etc/apt/sources.list; \
    fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# 拷贝运行所需（源码 + builder 构建产物）
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/server/src packages/server/src
COPY --from=builder /app/packages/server/package.json packages/server/
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/vfx/dist packages/vfx/dist
COPY --from=builder /app/packages/vfx/package.json packages/vfx/
COPY --from=builder /app/packages/assembly/dist packages/assembly/dist
COPY --from=builder /app/packages/assembly/package.json packages/assembly/
COPY --from=builder /app/packages/studio/dist packages/studio/dist
COPY --from=builder /app/build/plugins build/plugins

# 运行阶段没有 plugins/ 源码目录；补一个占位 workspace，避免 bun 报 "Workspace not found"
RUN mkdir -p plugins \
    && printf '{"name":"@piano/plugins","version":"0.0.0","private":true}\n' > plugins/package.json

# 只装 server 运行时依赖（hono + amt-cli + @piano/core）。不带 lockfile，production 全新解析
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --production --no-save --filter @piano/server

WORKDIR /app/packages/server
ENV PORT=3000 DB_PATH=/app/data/piano.db LOG_FILE=/app/data/logs/server.log WEB_ROOT=/app/packages/studio/dist BUILTIN_PLUGINS_DIR=/app/build/plugins
VOLUME /app/data
CMD ["bun", "src/index.ts"]
