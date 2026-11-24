import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        // 开发模式：/api 转发到本地 server
        proxy: {
            "/api": "http://127.0.0.1:3000",
        },
    },
    build: {
        outDir: "dist",
    },
});