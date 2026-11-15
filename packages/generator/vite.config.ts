import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    // 静态资源绝对路径：站点部署在域名根路径，React Router 深链接需要稳定解析
    base: "/",
    plugins: [react(), tailwindcss()],
    build: {
        outDir: "dist",
    },
});
