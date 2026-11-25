import { describe, expect, test } from "bun:test";
import { midiMenuActions, registerMidiMenuAction } from "../src/app/ui/midi/menuActions";

describe("MIDI optional menu actions", () => {
    test("base build starts with no optional entries", () => {
        expect(midiMenuActions()).toEqual([]);
    });

    test("registration is explicit and idempotent by id", () => {
        registerMidiMenuAction({ id: "demo", label: "演示", open: () => {} });
        registerMidiMenuAction({ id: "demo", label: "演示(更新)", open: () => {} });
        expect(midiMenuActions().map(action => action.label)).toEqual(["演示(更新)"]);
    });
});
