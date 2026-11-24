import type { AddonTemplate } from "@bepack/addon";
import {
    LEGACY_MIDI_TREE,
    loadAddonTemplate,
    parseExistingMidis as parseExistingAssemblyMidis,
    templateMidiTree,
    type TemplateInfo as AssemblyTemplateInfo,
} from "@piano/assembly";
import type { SongEntry } from "../types";

export { LEGACY_MIDI_TREE, templateMidiTree };

export interface TemplateInfo extends Omit<AssemblyTemplateInfo, "songs"> {
    songs: SongEntry[];
}

/**
 * 加载并解析 addon 模板（.mcaddon 即 zip），委托 @piano/assembly。
 */
export async function loadTemplate(fileOrBlob: Blob | Uint8Array): Promise<TemplateInfo> {
    const info = await loadAddonTemplate(fileOrBlob);
    return {
        ...info,
        songs: info.songs.map((entry) => ({
            ...entry,
            isOriginal: entry.isOriginal ?? true,
        })),
    };
}

export function parseExistingMidis(
    addon: AddonTemplate,
    midisDir: string,
): SongEntry[] {
    return parseExistingAssemblyMidis(addon, midisDir).map((entry) => ({
        ...entry,
        isOriginal: entry.isOriginal ?? true,
    }));
}
