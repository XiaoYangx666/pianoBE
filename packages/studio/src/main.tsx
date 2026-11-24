import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { ToastHost, initTheme } from "@piano/ui";
import App from "./App";
import "./styles/app.css";

initTheme();

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <HashRouter>
            <App />
            <ToastHost />
        </HashRouter>
    </StrictMode>,
);
