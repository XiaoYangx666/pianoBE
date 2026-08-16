# ---- 构建阶段 ----
# 说明：addon 为预构建产物，不进入镜像。
# 这里只安装后端依赖树需要的 workspace（core / server / web），
# workspaces glob 仅匹配实际拷贝的目录，因此 sapi-pro、@minecraft/* 等
# addon 依赖不会出现在镜像依赖树中。
FROM oven/bun:1 AS build
WORKDIR /app

# 根配置（workspaces: packages/*, apps/*）
COPY package.json ./

# 共享库（server 运行时需要其 dist）
COPY packages/core/package.json packages/core/
COPY packages/core/tsconfig.json packages/core/
COPY packages/core/src packages/core/src

# 后端（bun 直接运行 TS 源码）
COPY apps/server/package.json apps/server/
COPY apps/server/src apps/server/src

# 前端管理页（构建产物由 server 同源托管）
COPY apps/web/package.json apps/web/
COPY apps/web/tsconfig.json apps/web/
COPY apps/web/vite.config.ts apps/web/
COPY apps/web/index.html apps/web/
COPY apps/web/src apps/web/src

RUN bun install

# 构建共享库与前端
RUN bun run --filter @piano/core build
RUN bun run --filter @piano/web build

# 裁剪 devDependencies（vite 等构建工具），减小镜像体积
RUN bun install --production

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