/**
 * 构建目标注入标识符。
 * 由 bepack 构建期的 replace 替换为字符串字面量（"client" / "server"），
 * 经 rolldown 常量折叠 + 死代码消除裁剪对应分支。
 * 本文件只被 tsc 读取（类型检查），不被任何模块 import，
 * 因此不会进入 rolldown 模块图、不会被 replace 触碰。
 */
declare const __PIANO_TARGET__: "client" | "server";
