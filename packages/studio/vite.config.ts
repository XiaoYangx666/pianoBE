import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const isolationHeaders = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
};

const ortExternal = new URL(
    "../../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs",
    import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/, "$1");

export default defineConfig({
    base: "./",
    plugins: [tailwindcss(), react()],
    resolve: {
        alias: {
            "onnxruntime-web-external": ortExternal,
        },
    },
    server: {
        headers: isolationHeaders,
        proxy: {
            "/api": "http://localhost:3000",
        },
    },
    preview: {
        headers: isolationHeaders,
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
    },
});
