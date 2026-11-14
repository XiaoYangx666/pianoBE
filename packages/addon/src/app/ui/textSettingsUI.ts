import {
    DEFAULT_PIANO_SETTINGS,
    PIANO_SETTINGS_LIMITS,
    normalizePianoColor,
    type PianoSettings,
} from "@domain/piano/settings";
import { DDUI, type ObservableLike } from "sapi-pro";
import type { PianoRuntime } from "@app/PianoRuntime";
import { backButton } from "./ddui";
import { settingsEditor } from "./pianoSettings";

/** 文字设置：琴面 LCD 的可见性、颜色、大小与偏移。 */
export const TextSettingsPage = DDUI.page<{ piano: PianoRuntime }>("文字设置", (ui, args) => {
    const editor = settingsEditor(ui, args.piano);
    if (!editor) return;
    const settings = editor.current();
    if (!settings) return;

    if (!editor.hasScreen) {
        ui.label("§7这台三角钢琴没有琴面显示屏，文字设置不可用。");
        backButton(ui);
        ui.closeButton();
        return;
    }

    const textVisible = ui.boolean(settings.textVisible);
    ui.onChange(textVisible, (value) => editor.apply({ textVisible: value }));

    const color = (key: "titleColor" | "statusColor", initial: string) => {
        const observable = ui.string(initial);
        ui.onChange(observable, (input) => {
            const value = normalizePianoColor(input);
            if (value) editor.apply({ [key]: value } as Partial<PianoSettings>);
        });
        return observable;
    };
    const titleColor = color("titleColor", settings.titleColor);
    const statusColor = color("statusColor", settings.statusColor);

    const field = (
        key: "textScale" | "textRight" | "textUp" | "textForward" | "textDistance",
        observable: ObservableLike<number>
    ) => {
        ui.set(observable, settings[key]);
        ui.onChange(observable, (value) => editor.apply({ [key]: value } as Partial<PianoSettings>));
        return observable;
    };

    const textScale = field("textScale", ui.number(settings.textScale));
    const textRight = field("textRight", ui.number(settings.textRight));
    const textUp = field("textUp", ui.number(settings.textUp));
    const textForward = field("textForward", ui.number(settings.textForward));
    const textDistance = field("textDistance", ui.number(settings.textDistance));

    ui.label("§7只影响琴面 LCD 文字，不影响演奏与播放。");
    ui.toggle("显示琴面文字", textVisible);
    ui.textField("标题颜色", titleColor, { description: "输入 #RRGGBB，色值有效后生效" });
    ui.textField("状态颜色", statusColor, { description: "输入 #RRGGBB，色值有效后生效" });
    ui.slider("文字大小（%）", textScale, ...PIANO_SETTINGS_LIMITS.textScale, { step: 1 });
    ui.slider("文字左右偏移（1/16 格，向右为正）", textRight, ...PIANO_SETTINGS_LIMITS.textRight, { step: 1 });
    ui.slider("文字上下偏移（1/16 格，向上为正）", textUp, ...PIANO_SETTINGS_LIMITS.textUp, { step: 1 });
    ui.slider("文字前后偏移（1/16 格，朝演奏者为正）", textForward, ...PIANO_SETTINGS_LIMITS.textForward, { step: 1 });
    ui.slider("文字可见距离（格）", textDistance, ...PIANO_SETTINGS_LIMITS.textDistance, { step: 1 });
    ui.button("恢复本页默认", () => {
        editor.apply({
            textVisible: DEFAULT_PIANO_SETTINGS.textVisible,
            titleColor: DEFAULT_PIANO_SETTINGS.titleColor,
            statusColor: DEFAULT_PIANO_SETTINGS.statusColor,
            textScale: DEFAULT_PIANO_SETTINGS.textScale,
            textRight: DEFAULT_PIANO_SETTINGS.textRight,
            textUp: DEFAULT_PIANO_SETTINGS.textUp,
            textForward: DEFAULT_PIANO_SETTINGS.textForward,
            textDistance: DEFAULT_PIANO_SETTINGS.textDistance,
        });
        ui.reopen();
    });
    backButton(ui);
    ui.closeButton();
});
