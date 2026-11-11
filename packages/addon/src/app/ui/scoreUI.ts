import { Player, system } from "@minecraft/server";
import { CustomForm, DataDrivenScreenClosedReason, ObservableBoolean, ObservableString } from "@minecraft/server-ui";
import { DDUIManager } from "@app/ui/ddui";
import { normalizePianoSettings, type PianoSettings } from "@domain/piano/settings";
import { AVAILABLE_SCORES, scoreAt, scoreIndexOf, type PianoScore } from "@domain/score/score";
import type { PianoRuntime } from "@app/PianoRuntime";

/** 每页显示多少个曲谱按钮；超过后通过上一页/下一页浏览。 */
const PAGE_SIZE = 6;

interface ScoreTarget {
    piano: PianoRuntime;
    displayId: string;
}

/**
 * 曲谱配置：安装/卸载谱架，搜索并切换当前曲谱。
 *
 * 曲谱数量可能很多，因此列表不放进钢琴主面板，也不使用下拉框；这里用
 * 动态按钮分页展示，顶部输入框按标题或 id 过滤。
 */
class PianoScoreForm {
    private readonly form: CustomForm;
    private readonly mount: ObservableBoolean;
    private readonly search: ObservableString;
    private readonly status: ObservableString;
    private readonly pageLabel: ObservableString;
    private readonly slots: ObservableString[] = [];
    private readonly slotVisible: ObservableBoolean[] = [];
    private readonly prevDisabled = new ObservableBoolean(true);
    private readonly nextDisabled = new ObservableBoolean(true);
    private items: readonly PianoScore[] = [];
    private page = 0;
    private target?: ScoreTarget;
    private unsubscribe?: () => void;
    private opening = false;
    private syncing = false;
    private readonly empty = AVAILABLE_SCORES.length === 0;

    constructor(private readonly player: Player) {
        const writable = { clientWritable: true };
        this.mount = new ObservableBoolean(false, writable);
        this.search = new ObservableString("", writable);
        this.status = new ObservableString("当前曲谱：无");
        this.pageLabel = new ObservableString("第 1 / 1 页");

        if (this.empty) {
            this.form = new CustomForm(player, "曲谱配置")
                .label("当前资源包没有曲谱\n请通过生成器导入真实谱面图片或 PDF")
                .closeButton();
            return;
        }

        this.mount.subscribe(value => {
            if (this.syncing || !this.target) return;
            this.apply({ scoreMounted: value });
            this.render();
        });
        this.search.subscribe(() => {
            if (this.syncing) return;
            this.page = 0;
            this.render();
        });

        this.form = new CustomForm(player, "曲谱配置")
            .label(this.status)
            .toggle("安装谱架", this.mount)
            .label("   ")
            .textField("搜索曲谱标题或 id", this.search)
            .label(this.pageLabel);

        for (let slot = 0; slot < PAGE_SIZE; slot++) {
            const label = new ObservableString("");
            const visible = new ObservableBoolean(false);
            this.slots.push(label);
            this.slotVisible.push(visible);
            this.form.button(label, () => this.choose(slot), { visible });
        }

        this.form
            .button("上一页", () => this.turnPage(-1), { disabled: this.prevDisabled })
            .button("下一页", () => this.turnPage(1), { disabled: this.nextDisabled })
            .closeButton();
    }

    private filtered() {
        const query = this.search.getData().trim().toLowerCase();
        if (!query) return AVAILABLE_SCORES;
        return AVAILABLE_SCORES.filter(score =>
            score.title.toLowerCase().includes(query) || score.id.toLowerCase().includes(query)
        );
    }

    private render() {
        if (!this.target) return;
        this.items = this.filtered();
        const pages = Math.max(1, Math.ceil(this.items.length / PAGE_SIZE));
        this.page = Math.max(0, Math.min(this.page, pages - 1));
        const selected = this.target.piano.settings?.scoreId;

        for (let slot = 0; slot < PAGE_SIZE; slot++) {
            const score = this.items[this.page * PAGE_SIZE + slot];
            this.slotVisible[slot].setData(score !== undefined);
            this.slots[slot].setData(score
                ? `${score.title}   ${score.pages.length} 页${score.id === selected ? "   [当前]" : ""}`
                : "");
        }

        const current = scoreAt(scoreIndexOf(selected));
        this.status.setData(
            `当前曲谱：${current?.title ?? "无"}\n§7共 ${AVAILABLE_SCORES.length} 张，匹配 ${this.items.length} 张`
        );
        this.pageLabel.setData(`第 ${this.page + 1} / ${pages} 页`);
        this.prevDisabled.setData(this.page <= 0);
        this.nextDisabled.setData(this.page >= pages - 1);
    }

    private turnPage(step: number) {
        const pages = Math.max(1, Math.ceil(this.items.length / PAGE_SIZE));
        const next = Math.max(0, Math.min(this.page + step, pages - 1));
        if (next === this.page) return;
        this.page = next;
        this.render();
    }

    private choose(slot: number) {
        const score = this.items[this.page * PAGE_SIZE + slot];
        if (!score) return;
        const current = this.target?.piano.settings;
        if (current?.scoreId === score.id) return;
        this.apply({ scoreId: score.id });
        this.render();
    }

    private apply(patch: Partial<PianoSettings>) {
        const target = this.target;
        if (!target || !this.player.isValid) return;
        const { piano, displayId } = target;
        const current = piano.settings;
        if (!current || piano.displayId !== displayId ||
            this.player.dimension.id !== piano.location.dimension.id ||
            piano.verify(system.currentTick) !== "complete") {
            this.close();
            return;
        }
        const next = normalizePianoSettings(patch, current);
        if (Object.keys(next).every(key => next[key as keyof PianoSettings] === current[key as keyof PianoSettings])) {
            return current;
        }
        if (piano.updateSettings(current, next)) return next;
        this.close();
    }

    async show(piano: PianoRuntime) {
        if (this.opening || this.form.isShowing()) return;
        if (this.empty) {
            this.opening = true;
            try {
                await this.form.show();
            } finally {
                this.opening = false;
            }
            return;
        }
        const settings = piano.settings;
        const displayId = piano.displayId;
        if (!settings || !displayId) {
            this.player.sendMessage("§e钢琴显示实体暂不可用。");
            return;
        }

        this.opening = true;
        try {
            this.syncing = true;
            try {
                this.mount.setData(settings.scoreMounted);
                this.search.setData("");
            } finally {
                this.syncing = false;
            }
            this.page = 0;
            this.target = { piano, displayId };
            this.unsubscribe = piano.disposedSignal.subscribe(() => this.close());
            this.render();
            for (let attempt = 0; attempt < 4 && this.target && this.player.isValid; attempt++) {
                if (await this.form.show() !== DataDrivenScreenClosedReason.UserBusy) return;
                await system.waitTicks(2);
            }
        } finally {
            this.opening = false;
            this.close();
        }
    }

    close() {
        const target = this.target;
        this.target = undefined;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        if (target) target.piano.flushSettings(target.displayId);
        if (this.player.isValid && this.form.isShowing()) this.form.close();
    }
}

class PianoScoreManager extends DDUIManager<PianoScoreForm> {
    protected create(player: Player) { return new PianoScoreForm(player); }
    protected discard(form: PianoScoreForm) { form.close(); }
}

export const pianoScoreManager = new PianoScoreManager();

export async function openScoreConfig(player: Player, piano: PianoRuntime) {
    if (!player.isValid) return;
    try {
        await pianoScoreManager.get(player).show(piano);
    } catch (error) {
        console.warn("[piano] 打开曲谱配置失败", error);
        if (player.isValid) player.sendMessage("§e无法打开曲谱配置。");
    }
}
