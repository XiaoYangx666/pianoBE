import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ToastHost, initTheme } from "@piano/ui";
import VfxLabPage from "./vfxLab/VfxLabPage";
import "./styles/app.css";

initTheme();

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <BrowserRouter>
            <VfxLabPage />
            <ToastHost />
        </BrowserRouter>
    </StrictMode>,
);
