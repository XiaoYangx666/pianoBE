import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ToastHost, initTheme } from "@piano/ui";
import App from "./App";
import "./styles/app.css";

// 挂载前决定主题，避免首帧闪一下
initTheme();

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <BrowserRouter>
            <App />
            <ToastHost />
        </BrowserRouter>
    </StrictMode>
);
