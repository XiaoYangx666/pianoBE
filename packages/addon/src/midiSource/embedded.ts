import type { MidiSong, MidiSongMeta, MidiSource } from "@piano/core";
import type { MidiInfo } from "../types";

/**
 * 内嵌曲库来源：读取构建期打包进 addon 的曲目模块（懒加载，仅在播放时 import）。
 * 作为 MidiSource 的离线兜底实现；server-net 环境由远程来源接管（阶段 4）。
 */
export class EmbeddedMidiSource implements MidiSource {
    private readonly metas: MidiSongMeta[];
    private readonly map = new Map<string, MidiInfo>();

    constructor(infos: MidiInfo[]) {
        this.metas = infos.map(({ id, name, duration }) => ({ id, name, duration }));
        for (const info of infos) {
            this.map.set(info.id, info);
        }
    }

    /** 同步返回（内嵌源元信息在构造时即齐备） */
    list(): MidiSongMeta[] {
        return this.metas;
    }

    async get(id: string): Promise<MidiSong | undefined> {
        const info = this.map.get(id);
        return info ? info.value() : undefined;
    }
}