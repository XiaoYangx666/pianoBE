import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 多线程 WASM（onnxruntime-web）需要跨源隔离；缺少这两个响应头时会自动回退单线程。
const isolationHeaders = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
};

// 使用 external-wasm 构建：运行时从 /amt/ 读取 WASM，避免把同一份二进制再打包进 dist。
// 选用 WASM-only 版本（约 15 MB），可满足 Cloudflare Workers 静态资源单文件上限。
const ortExternal = fileURLToPath(
    new URL("../../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs", import.meta.url)
);

export default defineConfig({
    base: "/",
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "onnxruntime-web-external": ortExternal,
        },
    },
    server: {
        headers: isolationHeaders,
    },
    preview: {
        headers: isolationHeaders,
    },
    build: {
        outDir: "dist",
    },
});
