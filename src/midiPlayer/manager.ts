import { Dimension, system, Vector3 } from "@minecraft/server";
import { MidiPlayer } from "./player";

class MidiPlayerManager {
    private players: MidiPlayer[] = [];
    private playerMap: Map<string, MidiPlayer> = new Map();
    private intervalId?: number;

    /** 每多少tick做一次清理 */
    private readonly CLEAN_INTERVAL = 20;
    private tickCount = 0;

    /** 硬上限 */
    private readonly MAX_PLAYERS = 20;

    /** 软上限（超过才开始cleanup） */
    private readonly SOFT_LIMIT = 12;

    /** 最大闲置时间 */
    private readonly MAX_IDLE_TIME = 1000 * 600;

    init() {
        if (this.intervalId !== undefined) return;

        this.intervalId = system.runInterval(() => {
            this.tick();
        });
    }

    /* ================== 核心 ================== */

    private tick() {
        const now = Date.now();

        for (let i = this.players.length - 1; i >= 0; i--) {
            const p = this.players[i];

            p.update(now);

            if (!p.isAlive()) {
                this.removeAt(i);
            }
        }

        // cleanup 只在超过软上限时启用
        if (this.players.length > this.SOFT_LIMIT) {
            this.tickCount++;

            if (this.tickCount >= this.CLEAN_INTERVAL) {
                this.tickCount = 0;
                this.cleanup(now);
            }
        } else {
            this.tickCount = 0;
        }
    }

    /* ================== 索引 ================== */

    private getKey(dimension: Dimension, pos: Vector3): string {
        return `${dimension.id}:${pos.x},${pos.y},${pos.z}`;
    }

    get(dimension: Dimension, pos: Vector3): MidiPlayer | undefined {
        return this.playerMap.get(this.getKey(dimension, pos));
    }

    has(dimension: Dimension, pos: Vector3): boolean {
        return this.playerMap.has(this.getKey(dimension, pos));
    }

    /* ================== 添加 ================== */

    add(player: MidiPlayer): MidiPlayer {
        const key = this.getKey(player.dimension, player.pos);

        //已存在 → 直接返回已有
        const existing = this.playerMap.get(key);
        if (existing) {
            return existing;
        }

        this.players.push(player);
        this.playerMap.set(key, player);

        this.ensureLimit();

        return player;
    }

    /* ================== 删除 ================== */

    private removeAt(index: number) {
        const p = this.players[index];
        const key = this.getKey(p.dimension, p.pos);

        this.playerMap.delete(key);
        this.players.splice(index, 1);
    }

    remove(player: MidiPlayer) {
        const index = this.players.indexOf(player);
        if (index !== -1) {
            this.removeAt(index);
        }
    }

    /* ================== 硬上限 ================== */

    private ensureLimit() {
        if (this.players.length <= this.MAX_PLAYERS) return;

        this.players.sort((a, b) => a.lastActiveTime - b.lastActiveTime);

        let removeCount = this.players.length - this.MAX_PLAYERS;

        // 优先删非播放
        for (let i = 0; i < this.players.length && removeCount > 0; i++) {
            const p = this.players[i];

            if (!p.isPlaying()) {
                p.stop();
                this.removeAt(i);
                i--;
                removeCount--;
            }
        }

        // 再删 playing（兜底）
        for (let i = 0; i < this.players.length && removeCount > 0; i++) {
            const p = this.players[i];

            p.stop();
            this.removeAt(i);
            i--;
            removeCount--;
        }
    }

    /* ================== 清理 ================== */

    private cleanup(now: number) {
        for (let i = this.players.length - 1; i >= 0; i--) {
            const p = this.players[i];

            if (now - p.lastActiveTime > this.MAX_IDLE_TIME) {
                p.stop();
                this.removeAt(i);
            }
        }
    }

    clear() {
        this.players.length = 0;
        this.playerMap.clear();
    }

    debugDump(): string {
        const now = Date.now();

        const total = this.players.length;

        let playing = 0;
        let paused = 0;
        let idle = 0;
        let stopped = 0;

        for (const p of this.players) {
            const state = p.getState();
            if (state === "playing") playing++;
            else if (state === "paused") paused++;
            else if (state === "idle") idle++;
            else if (state === "stopped") stopped++;
        }

        // 按最近活跃排序（最新在前）
        const sorted = [...this.players].sort(
            (a, b) => b.lastActiveTime - a.lastActiveTime
        );

        const lines: string[] = [];

        lines.push(`=== MidiPlayerManager Debug ===`);
        lines.push(
            `total=${total} | playing=${playing} paused=${paused} idle=${idle} stopped=${stopped}`
        );
        lines.push(
            `limits: soft=${this.SOFT_LIMIT} max=${this.MAX_PLAYERS} | idleTimeout=${this.MAX_IDLE_TIME}ms`
        );
        lines.push(`--------------------------------`);

        for (const p of sorted) {
            const info = p.getInfo();

            const idleTime = now - info.lastActiveTime;

            lines.push(
                `[${info.state.padEnd(7)}] ` +
                    `${info.dimension.id}@(${info.pos.x},${info.pos.y},${info.pos.z}) | ` +
                    `midi="${info.midiName}" | ` +
                    `notes=${info.currentNoteIndex}/${info.totalNotes} ` +
                    `(${(info.progress * 100).toFixed(1)}%) | ` +
                    `time=${info.currentTime.toFixed(2)}s | ` +
                    `queue=${info.queueLength} | ` +
                    `idle=${Math.floor(idleTime / 1000)}s`
            );
        }

        return lines.join("\n");
    }
}

export const midiPlayerManager = new MidiPlayerManager();
