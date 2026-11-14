import type { DDUIContext, contextArgs } from "sapi-pro";

/** 每个多级页面都放一个显式“返回”，手柄/触屏不依赖 ESC。 */
export function backButton(ui: DDUIContext<contextArgs>, label = "返回") {
    ui.button(label, () => ui.back());
}
