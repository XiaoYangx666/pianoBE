# AMT 浏览器端 CQT 参数

`cqt_meta.json` 是 AMT 多速率 log-CQT 的稀疏基与推理参数，供
`packages/studio/src/amt/cqt.ts` 在浏览器里计算频谱。

- 数据与 Rust 版 `amt-cli` 使用的 `cqt_multirate.bin` 同源，由 AMT 的
  `amt/features/cqt_multirate.npz` 导出。
- 文件只有约 41 KB，直接随仓库提交；`packages/studio/scripts/sync.mjs`
  在构建前把它复制到 `packages/studio/public/amt/`。
- 模型权重不随仓库提交，由 npm 依赖 `amt-cli` 提供（`run4_int8.onnx`）。

许可与署名见仓库根目录的 [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)。
