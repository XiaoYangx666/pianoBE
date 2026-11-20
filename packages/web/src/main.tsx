import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router-dom";
import { ToastHost, initTheme } from "@piano/ui";
import App from "./App";
import "./styles/app.css";

// 挂载前决定主题，避免首帧闪一下
initTheme();
const VfxLabPage = lazy(() => import("./vfxLab/VfxLabPage"));
const ReplayPage = lazy(() => import("./vfxLab/replay/ReplayPage"));

function PianoPage() {
    const { pathname } = useLocation();
    if (/^\/vfx-lab\/replay\/?$/.test(pathname)) return <Suspense fallback={null}><ReplayPage /></Suspense>;
    return /^\/vfx-lab\/?$/.test(pathname) ? <Suspense fallback={null}><VfxLabPage /></Suspense> : <App />;
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <BrowserRouter>
            <PianoPage />
            <ToastHost />
        </BrowserRouter>
    </StrictMode>
);
