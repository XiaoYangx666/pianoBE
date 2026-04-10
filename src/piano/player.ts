import { Player, system } from "@minecraft/server";
import { processNote } from "./func";
import { MidiJson, MidiNote, NoteInfo } from "./types";

let playIntervalId: number | undefined;

function playMidiNote(player: Player, info: NoteInfo, velocity: number) {
    if (info.sample === "none") return;

    // 播放音效
    player.playSound(`piano.${info.sample}`, {
        pitch: info.pitch,
        volume: Math.min(velocity, 1.0),
    });
}

export function playMidi(player: Player, midiData: MidiJson) {
    stopMidi();

    // 安全地提取所有音符，处理 notes 可能不存在的情况
    const allNotes: MidiNote[] = [];
    midiData.tracks.forEach((track) => {
        if (track.notes && Array.isArray(track.notes)) {
            allNotes.push(...track.notes);
        }
    });

    // 按时间从小到大排序
    allNotes.sort((a, b) => a.time - b.time);

    const startTime = Date.now();
    let nextNoteIndex = 0;

    if (playIntervalId) {
        system.clearRun(playIntervalId);
    }

    playIntervalId = system.runInterval(() => {
        const elapsedSeconds = (Date.now() - startTime) / 1000;

        while (
            nextNoteIndex < allNotes.length &&
            allNotes[nextNoteIndex].time <= elapsedSeconds
        ) {
            const note = allNotes[nextNoteIndex];
            const noteInfo = processNote(note.midi, false);

            playMidiNote(player, noteInfo, note.velocity);

            nextNoteIndex++;
        }

        if (nextNoteIndex >= allNotes.length) {
            stopMidi();
        }
    });
}

export function stopMidi() {
    if (playIntervalId !== undefined) {
        system.clearRun(playIntervalId);
        playIntervalId = undefined;
    }
}
