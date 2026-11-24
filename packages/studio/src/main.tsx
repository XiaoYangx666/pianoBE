import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { ToastHost, initTheme } from "@piano/ui";
import App from "./App";
import "./styles/app.css";

interface ErrorBoundaryState {
    error: Error | null;
}

class StudioErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
    state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("[studio] 渲染异常", error, info);
    }

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div className="grid min-h-dvh place-items-center bg-ore-sunken p-4 text-ore-text">
                <div className="w-full max-w-md rounded-xl border border-ore-border bg-ore-raised p-6 shadow-lg">
                    <h1 className="text-[16px] font-semibold">PianoBE Studio 页面加载失败</h1>
                    <p className="mt-2 break-words rounded-md border border-ore-divider bg-ore-sunken p-3 font-mono text-[12px] text-ore-dim">
                        {this.state.error.message || String(this.state.error)}
                    </p>
                    <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-brand px-4 text-[13px] font-medium text-white hover:bg-brand-hover"
                    >
                        刷新页面
                    </button>
                </div>
            </div>
        );
    }
}

initTheme();

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <StudioErrorBoundary>
            <HashRouter>
                <App />
                <ToastHost />
            </HashRouter>
        </StudioErrorBoundary>
    </StrictMode>,
);
