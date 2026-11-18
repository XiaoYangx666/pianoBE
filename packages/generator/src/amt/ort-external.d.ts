/**
 * onnxruntime-web 的 external-wasm WASM 构建（由 vite alias 指向
 * node_modules/onnxruntime-web/dist/ort.wasm.min.mjs）。
 * 复用官方类型定义。
 */
declare module "onnxruntime-web-external" {
    export * from "onnxruntime-web";
}
