import { DDUI, type DDUIContext, type contextArgs } from "sapi-pro";

const USER_CLOSED = "UserClosed";

/**
 * PianoBE 的 DDUI 页面包装。
 *
 * sapi-pro 默认把“玩家按 ESC/关闭”当成关闭整个界面；对多级页面来说这不符合
 * 直觉（在子页面关闭应该回上一层）。这里只接管 UserClosed：
 * - 栈深 > 1 → 弹出一层，回到上一页；
 * - 栈深 = 1 → 保持默认行为（关闭界面并清空栈）。
 *
 * 程序化跳转（push/back/replace/close）由 DDUI 自身处理，reason 不是
 * UserClosed，因此不会被这里重复弹栈。
 */
export function appPage<T extends contextArgs = contextArgs>(
    title: string,
    build: (ui: DDUIContext<T>, args: T) => void
) {
    const page = DDUI.page<T>(title, build);
    const baseHandler = page.handler;
    page.handler = ((reason: any, context: any) => {
        if (reason === USER_CLOSED && context?.depth > 1) {
            const session = context._dduiSession;
            if (session) {
                session.navigate(() => context.back());
                return;
            }
        }
        return baseHandler(reason, context);
    }) as typeof page.handler;
    return page;
}

/** 每个多级页面都放一个显式“返回”，手柄/触屏不依赖 ESC。 */
export function backButton(ui: DDUIContext<contextArgs>, label = "返回") {
    ui.button(label, () => ui.back());
}
