import { DDUI } from "sapi-pro";
import type { PianoSettings } from "@domain/piano/settings";
import { AVAILABLE_SCORES, scoreAt, scoreIndexOf, type PianoScore } from "@domain/score/score";
import type { PianoRuntime } from "@app/PianoRuntime";
import { settingsEditor } from "./pianoSettings";

/** 每页显示多少个曲谱按钮；超过后通过上一页/下一页浏览。 */
const PAGE_SIZE = 6;

/**
 * 曲谱配置：安装/卸载谱架，搜索并切换当前曲谱。
 *
 * 曲谱数量可能很多，因此列表不放进钢琴主面板，也不使用下拉框；这里用
 * 动态按钮分页展示，顶部输入框按标题或 id 过滤。
 *
 * 页面内所有 Observable 与订阅由 DDUI 作用域托管，关闭/返回后自动释放。
 */
export const PianoScorePage = DDUI.page<{ piano: PianoRuntime }>("曲谱配置", (ui, args) => {
    const piano = args.piano;
    const editor = settingsEditor(ui, piano);
    if (!editor) return;
    const settings = editor.current();
    if (!settings) return;

    const empty = AVAILABLE_SCORES.length === 0;
    const mount = ui.boolean(settings.scoreMounted);
    const search = ui.string("");
    const status = ui.string("");
    const pageLabel = ui.string("");
    const slots = Array.from({ length: PAGE_SIZE }, () => ui.string(""));
    const slotVisible = Array.from({ length: PAGE_SIZE }, () =>
        ui.boolean(false, { clientWritable: false })
    );
    const prevDisabled = ui.boolean(true, { clientWritable: false });
    const nextDisabled = ui.boolean(true, { clientWritable: false });

    let items: readonly PianoScore[] = [];
    let page = 0;

    const filtered = () => {
        const query = search.getData().trim().toLowerCase();
        if (!query) return AVAILABLE_SCORES;
        return AVAILABLE_SCORES.filter(
            (score) =>
                score.title.toLowerCase().includes(query) || score.id.toLowerCase().includes(query)
        );
    };

    /** 目标仍有效时保存补丁；失效就关面板 */
    const apply = (patch: Partial<PianoSettings>) => editor.apply(patch);

    /** 把过滤结果、分页状态和当前选择写进原生 Observable */
    const render = () => {
        items = filtered();
        const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
        page = Math.max(0, Math.min(page, pages - 1));
        const selected = piano.settings?.scoreId;

        for (let slot = 0; slot < PAGE_SIZE; slot++) {
            const score = items[page * PAGE_SIZE + slot];
            slotVisible[slot].setData(score !== undefined);
            slots[slot].setData(
                score
                    ? `${score.title}   ${score.pages.length} 页${score.id === selected ? "   [当前]" : ""}`
                    : ""
            );
        }

        const current = scoreAt(scoreIndexOf(selected));
        status.setData(
            empty
                ? "当前曲谱：无\n§7资源包内没有曲谱，请通过生成器导入"
                : `当前曲谱：${current?.title ?? "无"}\n§7共 ${AVAILABLE_SCORES.length} 张，匹配 ${items.length} 张`
        );
        pageLabel.setData(empty ? "没有曲谱" : `第 ${page + 1} / ${pages} 页`);
        prevDisabled.setData(page <= 0);
        nextDisabled.setData(page >= pages - 1);
    };

    const turnPage = (step: number) => {
        const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
        const next = Math.max(0, Math.min(page + step, pages - 1));
        if (next === page) return;
        page = next;
        render();
    };

    const choose = (slot: number) => {
        const score = items[page * PAGE_SIZE + slot];
        if (!score) return;
        if (piano.settings?.scoreId === score.id) return;
        if (apply({ scoreId: score.id })) render();
    };

    ui.onChange(mount, (value) => {
        if (apply({ scoreMounted: value })) render();
    });
    ui.onChange(search, () => {
        page = 0;
        render();
    });

    ui.label(status).toggle("安装谱架", mount);
    if (empty) {
        ui.label("§7当前资源包没有曲谱\n请通过生成器导入真实谱面图片或 PDF\n仍可先安装空白谱架");
    }
    ui.label("   ").textField("搜索曲谱标题或 id", search).label(pageLabel);

    for (let slot = 0; slot < PAGE_SIZE; slot++) {
        ui.button(slots[slot], () => choose(slot), { visible: slotVisible[slot] });
    }

    ui.button("上一页", () => turnPage(-1), { disabled: prevDisabled })
        .button("下一页", () => turnPage(1), { disabled: nextDisabled })
        .divider();
    ui.closeButton();

    render();
});
