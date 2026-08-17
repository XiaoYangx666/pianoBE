import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    server: {
        // 开发模式：/api 转发到本地 server
        proxy: {
            "/api": "http://localhost:3000",
        },
    },
    build: {
        outDir: "dist",
    },
});