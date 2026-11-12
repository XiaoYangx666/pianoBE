import type { MidiSongMeta } from "@piano/core";
import { decodeBase64Url } from "@piano/core";
import type { MidiInfo } from "@data/types";

/**
 * 内嵌曲库来源：读取构建期打包进 addon 的 PBE2 模块（懒加载，仅在播放时 import）。
 * 模块内容 = Base64URL(PBE2)，元信息仍由索引单独提供。
 * 作为 MidiSource 的离线兜底实现；server-net 环境由远程来源接管。
 */
export class EmbeddedMidiSource {
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

    async get(id: string): Promise<Uint8Array | undefined> {
        const info = this.map.get(id);
        if (!info) return undefined;
        const encoded = await info.value();
        return decodeBase64Url(encoded);
    }
}
