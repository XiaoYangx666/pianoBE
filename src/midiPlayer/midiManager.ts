import { MidiInfo } from "@types";

export class MidiManager {
    private readonly midiMap: Map<string, MidiInfo>;
    private readonly midis: MidiInfo[];

    constructor(midis: MidiInfo[]) {
        this.midis = midis;
        this.midiMap = new Map(midis.map((t) => [t.id, t]));
    }

    /**获取midi列表 */
    list() {
        return this.midis;
    }

    /**获取info */
    getInfo(id: string) {
        return this.midiMap.get(id);
    }

    /**根据id获取内容 */
    load(info: MidiInfo) {
        return info.value();
    }

    /**根据midiId列表获取midiInfo列表，去除无法找到的 */
    fromIds(ids: string[]): MidiInfo[] {
        return ids
            .map((id) => this.midiMap.get(id))
            .filter((info) => info != undefined);
    }
}
