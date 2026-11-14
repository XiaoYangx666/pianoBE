/**
 * 测试用的最小 DDUI 宿主。
 *
 * 不模拟 XML/渲染，只实现页面代码实际用到的契约：
 * - 控件记录在 FakeCustomForm 上，便于点击；
 * - `ui.set` 不触发 `onChange`（与真实 WriteGuard 一致）；
 * - 跳转/关闭会立即释放页面作用域（与真实 DDUISession 一致）。
 */

export class FakeObservable<T> {
    static all: FakeObservable<unknown>[] = [];
    data: T;
    writes = 0;
    private readonly subscribers = new Set<(value: T) => void>();

    constructor(value: T) {
        this.data = value;
        FakeObservable.all.push(this as FakeObservable<unknown>);
    }

    setData(value: T) {
        if (Object.is(value, this.data)) return;
        this.data = value;
        this.writes++;
        for (const subscriber of [...this.subscribers]) subscriber(value);
    }

    getData() {
        return this.data;
    }

    subscribe(callback: (value: T) => void) {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    unsubscribe(callback: (value: T) => void) {
        return this.subscribers.delete(callback);
    }

    get listenerCount() {
        return this.subscribers.size;
    }
}

type ButtonHandler = () => void;

function labelText(label: unknown): string {
    if (label && typeof label === "object" && typeof (label as { getData?: unknown }).getData === "function") {
        return String((label as { getData(): unknown }).getData());
    }
    return String(label ?? "");
}

export class FakeCustomForm {
    static forms: FakeCustomForm[] = [];
    readonly buttons = new Map<string, ButtonHandler>();
    private readonly entries: Array<{ label: unknown; handler: ButtonHandler }> = [];
    readonly sliders: { label: string; value: FakeObservable<number> }[] = [];
    components: Array<Record<string, unknown>> = [];
    showing = false;
    onClose?: () => void;
    private resolveShow?: (reason: string) => void;

    constructor(
        readonly player: unknown,
        readonly title: string
    ) {
        FakeCustomForm.forms.push(this);
    }

    label(text?: unknown, options?: unknown) {
        this.components.push({ type: "label", text, options });
        return this;
    }
    header(text?: unknown, options?: unknown) {
        this.components.push({ type: "header", text, options });
        return this;
    }
    toggle(label?: unknown, value?: unknown, options?: unknown) {
        this.components.push({ type: "toggle", label, value, options });
        return this;
    }
    slider(label: string, value: FakeObservable<number>, min?: unknown, max?: unknown, options?: unknown) {
        this.sliders.push({ label, value });
        this.components.push({ type: "slider", label, value, min, max, options });
        return this;
    }
    dropdown(label?: unknown, value?: unknown, items?: unknown, options?: unknown) {
        this.components.push({ type: "dropdown", label, value, items, options });
        return this;
    }
    textField(label?: unknown, value?: unknown, options?: unknown) {
        this.components.push({ type: "textField", label, value, options });
        return this;
    }
    image(src?: unknown, pack?: unknown, options?: unknown) {
        this.components.push({ type: "image", src, pack, options });
        return this;
    }
    divider(options?: unknown) {
        this.components.push({ type: "divider", options });
        return this;
    }
    spacer(options?: unknown) {
        this.components.push({ type: "spacer", options });
        return this;
    }
    closeButton() {
        this.components.push({ type: "closeButton" });
        return this;
    }
    button(label: unknown, handler: ButtonHandler, options?: unknown) {
        this.entries.push({ label, handler });
        this.buttons.set(labelText(label), handler);
        this.components.push({ type: "button", label, options });
        return this;
    }

    show() {
        this.showing = true;
        return new Promise<string>((resolve) => {
            this.resolveShow = resolve;
        });
    }

    close() {
        if (!this.showing) return;
        this.showing = false;
        const resolve = this.resolveShow;
        this.resolveShow = undefined;
        resolve?.("ServerClosed");
        this.onClose?.();
    }

    isShowing() {
        return this.showing;
    }

    /** 模拟玩家直接关窗 */
    playerClose() {
        this.close();
    }

    click(label: string) {
        const entry = this.entries.find(item => labelText(item.label) === label);
        if (entry) {
            entry.handler();
            return;
        }
        const handler = this.buttons.get(label);
        if (!handler) throw new Error(`表单上没有按钮「${label}」：${this.buttonLabels().join(", ")}`);
        handler();
    }

    buttonLabels() {
        return this.entries.map(entry => labelText(entry.label));
    }

    /** 当前所有标签的可见文本（Observable 取当前值）。 */
    labelTexts() {
        return this.components
            .filter(component => component.type === "label")
            .map(component => labelText(component.text));
    }
}

export interface FakeNav {
    pushed: Array<{ form: unknown; args: any }>;
    closed: number;
    back: number;
}

export interface FakeDDUIHost {
    DDUI: {
        page: (title: string, build: (ui: FakeUI, args: any) => void) => Record<string, unknown>;
        open: (player: any, page: any, args?: any) => FakeUI;
        close: () => void;
        active: () => FakeUI | undefined;
    };
    nav: FakeNav;
    /** 当前显示的页面（未显示则为 undefined） */
    active: () => FakeUI | undefined;
    lastForm: () => FakeCustomForm;
    forms: () => FakeCustomForm[];
    reset: () => void;
}

export class FakeUI {
    readonly form: FakeCustomForm;
    private readonly cleanups: Array<() => void> = [];
    private readonly writing = new WeakSet<object>();
    private closed = false;
    private navigating = false;
    private owner: any;

    get player(): any { return this.owner; }

    constructor(
        player: any,
        readonly args: any,
        title: string,
        private readonly nav: FakeNav
    ) {
        this.owner = player;
        this.form = new FakeCustomForm(player, title);
        this.form.onClose = () => this.dispose();
    }

    get isClosed() {
        return this.closed;
    }

    number(value: number, _options?: unknown) {
        return new FakeObservable(value);
    }
    string(value: string, _options?: unknown) {
        return new FakeObservable(value);
    }
    boolean(value: boolean, _options?: unknown) {
        return new FakeObservable(value);
    }

    computed(depsOrCompute: FakeObservable<any>[] | (() => unknown), maybeCompute?: () => unknown) {
        const deps = typeof depsOrCompute === "function" ? [] : depsOrCompute;
        const compute = typeof depsOrCompute === "function" ? depsOrCompute : maybeCompute!;
        const result = new FakeObservable(compute());
        for (const dep of deps) {
            this.subscribe(dep, () => {
                const next = compute();
                if (next !== result.getData()) result.setData(next);
            });
        }
        return result;
    }

    onChange(observable: FakeObservable<any>, callback: (value: any) => void) {
        const off = observable.subscribe((value: any) => {
            if (this.closed || this.writing.has(observable as unknown as object)) return;
            callback(value);
        });
        this.cleanups.push(off);
    }

    watch(deps: FakeObservable<any>[], callback: () => void, immediate = true) {
        if (immediate && !this.closed) callback();
        for (const dep of deps) {
            this.cleanups.push(
                dep.subscribe(() => {
                    if (!this.closed) callback();
                })
            );
        }
    }

    set(observable: FakeObservable<any>, value: any) {
        if (Object.is(observable.getData(), value)) return;
        const key = observable as unknown as object;
        this.writing.add(key);
        try {
            observable.setData(value);
        } finally {
            this.writing.delete(key);
        }
    }

    get(observable: FakeObservable<any>) {
        return observable.getData();
    }

    subscribe(source: any, callback: (value: any) => void) {
        const wrapped = (value: any) => {
            if (this.closed) return;
            callback(value);
        };
        const handle = source.subscribe(wrapped);
        // 原生 Observable：subscribe 返回的是回调本身，必须 unsubscribe(wrapped)
        if (typeof source.getData === "function" && typeof source.unsubscribe === "function") {
            this.cleanups.push(() => source.unsubscribe(wrapped));
        } else if (typeof handle === "function") {
            this.cleanups.push(handle);
        }
        return () => {};
    }

    own(cleanup: () => void) {
        this.cleanups.push(cleanup);
        return () => {};
    }

    onClose(callback: () => void) {
        this.cleanups.push(callback);
    }

    retain<T extends { retain(): void; release(): void }>(resource: T) {
        resource.retain();
        this.cleanups.push(() => resource.release());
        return resource;
    }

    timeout(callback: () => void, _ticks?: number) {
        const handle = { cancel: false };
        this.cleanups.push(() => {
            handle.cancel = true;
        });
        queueMicrotask(() => {
            if (!handle.cancel && !this.closed) callback();
        });
        return () => {
            handle.cancel = true;
        };
    }

    interval(_callback: () => void, _ticks?: number) {
        return () => {};
    }

    label(text?: unknown, options?: unknown) {
        this.form.label(text, options);
        return this;
    }
    header(text?: unknown, options?: unknown) {
        this.form.header(text, options);
        return this;
    }
    toggle(label: unknown, value: unknown, options?: unknown) {
        this.form.toggle(label, value, options);
        return this;
    }
    slider(label: string, value: FakeObservable<number>, min?: number, max?: number, options?: unknown) {
        this.form.slider(label, value, min, max, options);
        return this;
    }
    dropdown(label: unknown, value: unknown, items: unknown, options?: unknown) {
        this.form.dropdown(label, value, items, options);
        return this;
    }
    textField(label: unknown, value: unknown, options?: unknown) {
        this.form.textField(label, value, options);
        return this;
    }
    image(src: unknown, pack: string, options?: unknown) {
        this.form.image(src, pack, options);
        return this;
    }
    divider(options?: unknown) {
        this.form.divider(options);
        return this;
    }
    spacer(options?: unknown) {
        this.form.spacer(options);
        return this;
    }
    closeButton() {
        this.form.closeButton();
        return this;
    }

    button(label: unknown, onClick: () => void, options?: unknown) {
        this.form.button(label, () => {
            if (this.closed || this.navigating || !this.player.isValid) return;
            onClick();
        }, options);
        return this;
    }

    push(form: unknown, args?: any) {
        if (this.closed || this.navigating) return;
        this.navigating = true;
        this.nav.pushed.push({ form, args });
        this.dispose();
        this.form.close();
    }

    replace(form: unknown, args?: any) {
        this.push(form, args);
    }

    reset(form: unknown, args?: any) {
        this.push(form, args);
    }

    back() {
        if (this.closed || this.navigating) return;
        this.navigating = true;
        this.nav.back++;
        this.dispose();
        this.form.close();
    }

    reopen() {
        this.dispose();
        this.form.close();
    }

    close() {
        if (this.closed) return;
        this.navigating = true;
        this.nav.closed++;
        this.dispose();
        this.form.close();
    }

    dispose() {
        if (this.closed) return;
        this.closed = true;
        for (const cleanup of [...this.cleanups].reverse()) cleanup();
        this.cleanups.length = 0;
        // 与实际 DDUIContext.release() 一致，销毁时断开 Player wrapper 引用。
        this.owner = undefined;
    }
}

export function createDDUIHost(): FakeDDUIHost {
    const nav: FakeNav = { pushed: [], closed: 0, back: 0 };
    let active: FakeUI | undefined;

    const DDUI = {
        page: (title: string, build: (ui: FakeUI, args: any) => void) => ({
            title,
            build,
            _ddui: true,
            handler: () => {},
        }),
        open: (player: any, page: any, args?: any) => {
            active?.close();
            const ui = new FakeUI(player, args, page.title, nav);
            active = ui;
            page.build(ui, args);
            void ui.form.show();
            return ui;
        },
        close: () => {
            active?.close();
            active = undefined;
        },
        active: () => active,
        stats: () => ({
            sessions: 0,
            activePlayers: 0,
            created: 0,
            disposed: 0,
            forms: 0,
            pendingShows: 0,
            completedShows: 0,
        }),
    };

    return {
        DDUI,
        nav,
        active: () => active,
        lastForm: () => FakeCustomForm.forms.at(-1)!,
        forms: () => FakeCustomForm.forms,
        reset: () => {
            for (const form of FakeCustomForm.forms) form.showing = false;
            FakeCustomForm.forms.length = 0;
            FakeObservable.all.length = 0;
            nav.pushed.length = 0;
            nav.closed = 0;
            nav.back = 0;
            active = undefined;
        },
    };
}

/**
 * 统一的 `sapi-pro` 测试替身。
 *
 * bun 的 `mock.module` 在同一进程内是全局的，多个测试文件各自注册不同形状的 mock
 * 会互相覆盖；所以所有需要 Mock sapi-pro 的测试都用这一份完整导出。
 */
export function createSapiProMock(host: FakeDDUIHost = createDDUIHost()) {
    class FakeField {
        key() {
            return this;
        }
        validator() {
            return this;
        }
    }

    return {
        DDUI: host.DDUI,
        Vector3Utils: {
            squaredDistance: (a: any, b: any) =>
                (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2,
        },
        formManager: { open: () => {} },
        // 平台存储模块在导入期就会取这些符号
        Configdb: { get: () => undefined, set: () => {} },
        DPDataBase: class {},
        CommonForm: {
            ButtonForm: (config: unknown) => config,
            InputForm: (config: unknown) => config,
            SimpleMessageForm: (config: unknown) => config,
            ConfigForm: () => ({ create: () => ({}) }),
        },
        FieldType: {
            String: "string",
            Number: "number",
            Toggle: "toggle",
            Slider: "slider",
            Dropdown: "dropdown",
        },
        NumberField: FakeField,
        TextField: FakeField,
        Validators: {
            numberRange: () => () => undefined,
            stringLength: () => () => undefined,
        },
    };
}

/** 统一的 `@app/midi` 测试替身（同样避免多文件 mock 形状不一致）。 */
export function createMidiAppMock(overrides: { page?: unknown } = {}) {
    const page = overrides.page ?? (async () => ({ items: [], total: 0 }));
    return {
        midiManager: {
            page,
            metaAll: async () => [],
            infoOf: async () => undefined,
            getInfo: () => undefined,
            addSource: () => {},
        },
        importedMidiManager: {
            page,
            metaAll: async () => [],
            infoOf: async () => undefined,
            getInfo: () => undefined,
            refresh: async () => {},
        },
        importedSongs: { save: () => ({}) },
    };
}
