import { beforeEach, describe, expect, mock, test } from "bun:test";
import { MidiPlayer } from "../src/domain/playback/player";

const page = mock(async () => ({ items: [], total: 0 }));
const getContent = mock(async () => [] as string[]);
const setContent = mock(async () => {});

mock.module("@app/midi", () => ({
    midiManager: {
        page,
        metaAll: async () => [],
        infoOf: async () => undefined,
        getInfo: () => undefined,
    },
    playlist: { getContent, setContent },
}));

class FakeField {
    key() { return this; }
    validator() { return this; }
}

mock.module("sapi-pro", () => ({
    formManager: { open: () => {} },
    CommonForm: {
        ButtonForm: (config: unknown) => config,
        InputForm: (config: unknown) => config,
        SimpleMessageForm: (config: unknown) => config,
    },
    NumberField: FakeField,
    TextField: FakeField,
    Validators: {
        numberRange: () => () => undefined,
        stringLength: () => () => undefined,
    },
}));

const { MidiListForm } = await import("../src/app/ui/midi/midiList");
const { QueueListForm } = await import("../src/app/ui/midi/queueUI");

const SONG_A = { id: "a", name: "A", duration: 400 };
const SONG_B = { id: "b", name: "B", duration: 400 };
const TRACK = {
    instrument: { family: "", number: 0, name: "" },
    notes: [60, 0, 15, 90],
};

function makeMidi() {
    return new MidiPlayer(
        { load: async (info) => ({ ...info, tracks: [TRACK] }) },
        { note() {}, playing() {} }
    );
}

function fakeCtx(args: Record<string, unknown>) {
    const ctx: any = {
        args,
        player: { sendMessage: () => {} },
        replaced: undefined,
        replace(_form: unknown, next: unknown) {
            ctx.replaced = next;
        },
    };
    return ctx;
}

beforeEach(() => {
    page.mockClear();
    getContent.mockClear();
    setContent.mockClear();
});

describe("MidiListForm 点歌行为", () => {
    test("队列已有该曲目时跳到已有项，不重复添加", async () => {
        const midi = makeMidi();
        midi.queue.enqueue(SONG_A);
        midi.queue.enqueue(SONG_B);
        midi.queue.jump(1);

        const ctx = fakeCtx({ midiPlayer: midi, p: 1 });
        await MidiListForm.handler(ctx, { data: SONG_A, btnIndex: 0 });

        expect(midi.queue.getLength()).toBe(2);
        expect(midi.queue.getIndex()).toBe(0);
        expect(ctx.replaced.notice).toContain("已跳到队列第 1 首");
    });

    test("队列没有该曲目时加入队尾", async () => {
        const midi = makeMidi();
        midi.queue.enqueue(SONG_A);

        const ctx = fakeCtx({ midiPlayer: midi, p: 1 });
        await MidiListForm.handler(ctx, { data: SONG_B, btnIndex: 0 });

        expect(midi.queue.getLength()).toBe(2);
        expect(midi.queue.export()).toEqual(["a", "b"]);
        expect(ctx.replaced.notice).toContain("已加入队列");
    });

    test("播放列表已有该曲目时不重复写入", async () => {
        getContent.mockResolvedValue(["a"]);

        const ctx = fakeCtx({ targetPlayListId: 1, p: 1 });
        await MidiListForm.handler(ctx, { data: SONG_A, btnIndex: 0 });

        expect(setContent).not.toHaveBeenCalled();
        expect(ctx.replaced.notice).toContain("已在列表中");
    });

    test("播放列表没有该曲目时写入一次", async () => {
        getContent.mockResolvedValue([]);

        const ctx = fakeCtx({ targetPlayListId: 1, p: 1 });
        await MidiListForm.handler(ctx, { data: SONG_A, btnIndex: 0 });

        expect(setContent).toHaveBeenCalledWith(1, ["a"]);
        expect(ctx.replaced.notice).toContain("已添加");
    });

    test("歌曲列表和队列列表不增加固定按钮数量", () => {
        const songForm: any = MidiListForm;
        expect(songForm.buttons.length + songForm.footerButtons.length).toBe(4);

        const queueForm: any = QueueListForm;
        expect(queueForm.buttons.length).toBe(4);
    });
});
