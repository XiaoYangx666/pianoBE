import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API_TARGET = "http://127.0.0.1:3000";

/**
 * 后端未启动时，Vite 的默认代理行为会给所有 /api 请求回 500，
 * 浏览器控制台会刷出 "Failed to load resource: 500"。
 * 这里改为返回结构化的响应：健康检查回 200 { ok: false }（让前端安静地回退本地模式），
 * 其余接口回 503 + 可读错误，方便定位问题。
 */
const apiProxy: ProxyOptions = {
    target: API_TARGET,
    configure(proxy) {
        // configure 在 Vite 自身注册错误处理之前执行，因此这里的 error 监听会先响应，
        // Vite 后续检测到 headersSent 就不会再写 500。
        proxy.on("error", (err, req, res) => {
            const response = res as
                | { headersSent?: boolean; writableEnded?: boolean; writeHead?: Function; end?: Function }
                | undefined;
            if (!response?.writeHead || !response.end) return;
            if (response.headersSent || response.writableEnded) return;
            const isHealth = (req.url ?? "").split("?")[0] === "/api/health";
            response.writeHead(isHealth ? 200 : 503, {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store",
            });
            response.end(
                JSON.stringify(
                    isHealth
                        ? { ok: false, reachable: false, error: `后端未启动（${API_TARGET}）` }
                        : {
                              error: `无法连接后端 ${API_TARGET}：${err.message}。请先运行 npm run dev:server。`,
                          },
                ),
            );
        });
    },
};

const isolationHeaders = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
};

const ortExternal = new URL(
    "../../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs",
    import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/**
 * 服务器版构建插件：将本地工作区、浏览器 ONNX 转录与前端 .mcaddon 装配依赖
 * 替换为轻量空壳，确保 `dist-server` 产物完全不包含客户端大依赖。
 */
function serverOnlyStubsPlugin(): Plugin {
    const localAdapterTarget = fileURLToPath(
        new URL("./src/adapters/localAdapter.ts", import.meta.url),
    ).replaceAll("\\", "/");
    const transcribeTarget = fileURLToPath(
        new URL("./src/amt/transcribe.ts", import.meta.url),
    ).replaceAll("\\", "/");
    const stubLocalAdapter = fileURLToPath(new URL("./src/stubs/localAdapter.ts", import.meta.url));
    const stubTranscribe = fileURLToPath(new URL("./src/stubs/transcribe.ts", import.meta.url));
    const stubAssembly = fileURLToPath(new URL("./src/stubs/assembly.ts", import.meta.url));
    const stubBepack = fileURLToPath(new URL("./src/stubs/bepackAddon.ts", import.meta.url));

    return {
        name: "pianobe-server-only-stubs",
        enforce: "pre",
        async resolveId(source, importer, options) {
            if (source === "@piano/assembly") return stubAssembly;
            if (source === "@bepack/addon") return stubBepack;
            if (source === "onnxruntime-web-external" || source === "onnxruntime-web") {
                return stubTranscribe;
            }
            if (
                importer &&
                (source.endsWith("/localAdapter") ||
                    source.endsWith("/localAdapter.ts") ||
                    source.endsWith("/transcribe") ||
                    source.endsWith("/transcribe.ts"))
            ) {
                const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
                if (resolved) {
                    const norm = resolved.id.replaceAll("\\", "/");
                    if (norm === localAdapterTarget) return stubLocalAdapter;
                    if (norm === transcribeTarget) return stubTranscribe;
                }
            }
            return null;
        },
    };
}

/**
 * 两种构建：
 * - 默认（本地/完整版）：`vite build` → dist/，含本地工作区、模板、插件、浏览器转录
 * - 服务器版：`vite build --mode server` → dist-server/，仅服务器管理模式与试听采样
 */
export default defineConfig(({ mode }) => {
    const serverOnly = mode === "server";
    return {
        base: "./",
        define: {
            __PIANOBE_SERVER_ONLY__: JSON.stringify(serverOnly),
            __PIANOBE_AMT_ASSETS__: serverOnly
                ? "{}"
                : readFileSync(new URL("./public/amt/manifest.json", import.meta.url), "utf8"),
        },
        publicDir: serverOnly ? "public-server" : "public",
        plugins: [
            ...(serverOnly ? [serverOnlyStubsPlugin()] : []),
            tailwindcss(),
            react(),
        ],
        resolve: {
            alias: {
                "onnxruntime-web-external": ortExternal,
            },
        },
        server: {
            headers: isolationHeaders,
            proxy: {
                "/api": apiProxy,
            },
        },
        preview: {
            headers: isolationHeaders,
        },
        build: {
            outDir: serverOnly ? "dist-server" : "dist",
            emptyOutDir: true,
        },
    };
});
