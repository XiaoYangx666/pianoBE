/**
 * 构建期开关：服务器发行版（单文件 exe）为 true。
 * Vite 的 define 会把标识符替换成字面量；这里保留 typeof 保护，
 * 让 bun test / 直接导入源码时也能安全取到默认值 false。
 */
export const SERVER_ONLY: boolean =
    typeof __PIANOBE_SERVER_ONLY__ === "undefined" ? false : __PIANOBE_SERVER_ONLY__;
