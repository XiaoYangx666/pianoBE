import { defineConfig } from "vite";

export default defineConfig({
    // 相对路径：任意子路径/域名部署（如 Cloudflare Workers）均可用
    base: "./",
    build: {
        outDir: "dist",
    },
});