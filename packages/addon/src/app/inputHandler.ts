import { keyMaps } from "@domain/piano/keymap";
import { parseInput } from "@domain/input/parse";
import type { Player } from "@minecraft/server";
import type { PianoState } from "@app/ui/pianoState";
import type { PianoRuntime } from "@app/PianoRuntime";
import { playerSoundLayer } from "@app/playerSound";
import { shortcutAction, type ShortcutBindings } from "@domain/piano/shortcuts";
import { switchComMode, switchSoundType } from "@app/ui/pianoUI";
import { scoreAt } from "@domain/score/score";

/** 处理本次新输入的字符里的快捷键；返回是否有状态被切换。 */
export function handleShortcuts(
    added: string,
    state: PianoState,
    player: Player,
    bindings: ShortcutBindings
): boolean {
    let changed = false;
    for (const char of added) {
        const action = shortcutAction(bindings, char);
        if (!action) continue;
        changed = true;
        switch (action) {
            case "compact":
                state.compact.setData(!state.compact.getData());
                break;
            case "octave":
                state.octave.setData(!state.octave.getData());
                break;
            case "sound":
                switchSoundType(state, player);
                break;
            case "legato":
                switchComMode(state, player);
                break;
            case "score":
                state.showScore.setData(!state.showScore.getData());
                break;
            case "prevPage":
            case "nextPage": {
                const total = scoreAt(state.score.getData())?.pages.length ?? 0;
                const next = state.scorePage.getData() + (action === "nextPage" ? 1 : -1);
                if (next >= 0 && next < total) state.scorePage.setData(next);
                break;
            }
        }
    }
    return changed;
}

export function handleInput(val: string, state: PianoState, piano: PianoRuntime, player: Player) {
    if (!val) return { keys: [], last: undefined, shouldClear: false };
    const comMode = state.mode.getData();
    const keyMap = keyMaps[state.keyMap.getData()].value;
    const octave = state.octave.getData();
    const { keys, notes } = parseInput(val, comMode, keyMap, octave);

    const layer = playerSoundLayer(player, piano);
    for (const note of notes) piano.playNote(note, layer, .15);

    return { keys, last: notes.at(-1), shouldClear: !comMode };
}
