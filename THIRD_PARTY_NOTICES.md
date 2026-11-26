# 第三方组件与模型

本仓库除 `packages/addon`（专有，All Rights Reserved）外的代码使用
[CC BY-NC 4.0](LICENSE)（禁止商业使用）。下列第三方作品有各自的许可，
**不因本仓库代码的许可而改变**。

## Automated Music Transcription 模型（CC BY-NC 4.0）

- 来源：[gityag/Automated-Music-Transcription](https://github.com/gityag/Automated-Music-Transcription)
- 许可：[Creative Commons Attribution-NonCommercial 4.0 International](https://creativecommons.org/licenses/by-nc/4.0/)
- 涉及文件（不随仓库提交；服务端通过 npm 依赖 `amt-cli` 获取，浏览器端由构建脚本生成）：
  - `run4_best.onnx` — 原始 fp32 权重
  - `run4_int8.onnx` — 对 `run4_best.onnx` 做 QDQ 静态量化得到（修改版本）
  - `run4_best_fp16.onnx` — 浏览器端 fp16 版本（修改版本）
- 要求：
  - 保留署名、来源链接和许可文本；
  - **仅限非商业使用**，包括不得用于付费服务、广告变现或以商业优势为目的的分发；
  - 再分发修改版本时需说明修改（如 int8 / fp16 转换）。
- 模型作者未提供商业授权；如需商业使用，请自行联系原作者取得许可。
- 许可全文：<https://creativecommons.org/licenses/by-nc/4.0/legalcode>

## ONNX Runtime（MIT）

- 来源：[microsoft/onnxruntime](https://github.com/microsoft/onnxruntime)
- 许可：MIT
- 分发形式：`onnxruntime.dll`（Windows）、`libonnxruntime.so*`（Linux）、WebAssembly 运行时

## Transkun v2（MIT）

- 来源：[Yujia-Yan/Transkun](https://github.com/Yujia-Yan/Transkun)
- 许可：MIT
- 用途：`tools/` 下的可选对照/补充转录工具，不参与默认服务端推理
