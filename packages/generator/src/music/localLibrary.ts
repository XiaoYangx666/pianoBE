import type { SongEntry } from "../types";
import { readSongHeader } from "@piano/core";

/**
 * 我的音乐：浏览器本地持久库（IndexedDB）。
 *
 * 只保存转码后的 PBE3 数据与展示元信息，不保留原始 .mid 文件。
 * 附加包页的 songs 只是当前工作区，不会写回这里。
 */

const DB_NAME = "pianobe-generator";
const DB_VERSION = 1;
const STORE = "my-music";

export interface StoredSong extends SongEntry {
    /** 加入本地库的时间，用于稳定排序 */
    createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
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
        request.onerror = () => reject(request.error ?? new Error("无法打开本地音乐库"));
    });
    return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("本地音乐库操作失败"));
    });
}

export async function listLocalSongs(): Promise<StoredSong[]> {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const rows = await requestToPromise(tx.objectStore(STORE).getAll() as IDBRequest<StoredSong[]>);
    // 旧版本可能存了 PBE2；运行时只支持 PBE3，过滤并提示重新导入。
    const valid = rows.filter((row) => {
        if (!row.data) return false;
        try {
            readSongHeader(row.data);
            return true;
        } catch {
            console.warn(`[localLibrary] 跳过旧格式曲目 ${row.id}（需要重新导入）`);
            return false;
        }
    });
    return valid.sort((a, b) => b.createdAt - a.createdAt);
}

export async function putLocalSongs(songs: StoredSong[]): Promise<void> {
    if (songs.length === 0) return;
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const song of songs) store.put(song);
    await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("写入本地音乐库失败"));
        tx.onabort = () => reject(tx.error ?? new Error("写入本地音乐库已取消"));
    });
}

export async function deleteLocalSong(id: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("删除本地曲目失败"));
    });
}
