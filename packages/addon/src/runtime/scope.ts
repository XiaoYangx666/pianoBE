import { RuntimeScope, type Disposable, type RuntimeResourceStats } from "@begame/tabletop";

export type PianoErrorReporter = (boundary: string, error: unknown) => void;

/** One diagnostic boundary for every runtime resource owned by PianoBE. */
export function reportPianoError(boundary: string, error: unknown): void {
    console.warn(`[piano] ${boundary}`, error);
}

/**
 * Piano-specific wrapper around Tabletop's RuntimeScope.
 *
 * RuntimeScope already gives structural ownership; this wrapper only adds:
 * - a named boundary for diagnostics;
 * - `own()` so one failing cleanup is reported instead of aborting the rest;
 * - `dispose()` that never throws, so callers can always finish unloading.
 */
export class PianoScope {
    readonly raw: RuntimeScope;

    constructor(
        parent: RuntimeScope,
        private readonly boundary: string,
        private readonly report: PianoErrorReporter = reportPianoError
    ) {
        // 错误回调只捕获 boundary/report 的值，不捕获 PianoScope 自身。
        // 即便 Tabletop 在 dispose 时已清空 #onError，也避免在存活期间多一条
        // PianoScope ↔ RuntimeScope 的环（循环 GC 不积极时会造成滞留）。
        const name = boundary;
        const reporter = report;
        this.raw = parent.child(undefined, error => reporter(name, error));
    }

    get disposed(): boolean { return this.raw.disposed; }
    get stats(): RuntimeResourceStats { return this.raw.stats; }
    get pending(): number { return this.raw.pending; }

    child(name: string): PianoScope {
        return new PianoScope(this.raw, `${this.boundary}.${name}`, this.report);
    }

    /** Own one cleanup. Failure is reported; sibling cleanups still run. */
    own(label: string, cleanup: () => void): Disposable {
        return this.raw.use({
            cancel: () => {
                try {
                    cleanup();
                } catch (error) {
                    this.report(`${this.boundary}.${label}`, error);
                }
            },
        });
    }

    schedule(delay: number, callback: () => void): Disposable {
        return this.raw.schedule(delay, callback);
    }

    interval(ticks: number, callback: () => void): Disposable {
        return this.raw.interval(ticks, callback);
    }

    subscribe<Args extends unknown[]>(
        source: (listener: (...args: Args) => void) => Disposable | (() => void),
        listener: (...args: Args) => void
    ): Disposable {
        return this.raw.subscribe(source, listener);
    }

    /** Idempotent and non-throwing; the runtime must always be able to finish unload. */
    dispose(): void {
        try {
            this.raw.dispose();
        } catch (error) {
            this.report(this.boundary, error);
        }
    }
}
