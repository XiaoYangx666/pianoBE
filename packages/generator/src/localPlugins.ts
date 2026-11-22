/**
 * 本地导入的第三方 / 歌曲附带 .pbeplugin 持久化仓库（IndexedDB）。
 *
 * 只存原始 .pbeplugin 字节与信任标记，内置插件由 public/plugins 同步提供，不写入这里。
 */

const DB_NAME = "pianobe-generator-plugins";
const DB_VERSION = 1;
const STORE = "plugins";

export interface StoredPlugin {
    id: string;
    bytes: Uint8Array;
    source: "local" | "song";
    trusted: boolean;
    importedAt: number;
    songSourceName?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") {
        return Promise.reject(new Error("当前运行环境不支持 IndexedDB"));
    }
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: "id" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("无法打开本地插件库"));
    });
    return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("本地插件库操作失败"));
    });
}

export async function listLocalPlugins(): Promise<StoredPlugin[]> {
    if (typeof indexedDB === "undefined") return [];
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const rows = await requestToPromise(tx.objectStore(STORE).getAll() as IDBRequest<StoredPlugin[]>);
    return rows
        .filter((row) => row.id && row.bytes instanceof Uint8Array)
        .sort((a, b) => b.importedAt - a.importedAt);
}

export async function putLocalPlugins(plugins: readonly StoredPlugin[]): Promise<void> {
    if (plugins.length === 0) return;
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const plugin of plugins) store.put(plugin);
    await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("保存本地插件失败"));
        tx.onabort = () => reject(tx.error ?? new Error("保存本地插件已取消"));
    });
}

export async function deleteLocalPlugin(id: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("卸载本地插件失败"));
    });
}
