# 音频转 MIDI（浏览器端 AMT）

生成器的「音频转 MIDI」页面在浏览器本地完成钢琴转录，音频不会上传：

```
音频解码（Web Audio）→ 16 kHz 单声道 → 多速率 log-CQT（JS）
→ ONNX Runtime Web（多线程 WASM）→ 音符解码 → SMF
```

推理链路与 [Automated-Music-Transcription](https://github.com/gityag/Automated-Music-Transcription)
的 `web_demo` 一致，模型使用 `run4_best_fp16.onnx`。

模型与运行时**不会自动下载**：进入页面后需手动点击「下载模型」（约 22 MB），
下载内容保存在浏览器 Cache Storage，之后转换完全离线。可在页面上随时清除缓存。

转换完成后，MIDI 与原音频都在**底部全局播放器**中试听：播放条可暂停/拖动/调节音量，
桌面端和移动端展开播放器都能看到钢琴卷帘形式的音符详情。离开页面 60 秒后自动释放
内存中的 ONNX session / WASM，缓存保留，下次使用时重新初始化。

## 资源同步

模型与 ONNX Runtime WASM 体积较大，不提交到仓库：

```powershell
$env:AMT_DIR="E:\Project\muscriptor\Automated-Music-Transcription"
npm run sync:amt -w @piano/generator
```

命令会在 `public/amt/` 生成：

| 文件 | 来源 |
|---|---|
| `run4_best_fp16.onnx` | AMT 仓库 `web_demo/` |
| `cqt_meta.json` | AMT 仓库 `web_demo/`（多速率 CQT 稀疏基） |
| `ort-wasm-simd-threaded.{wasm,mjs}` | 仓库根 `node_modules/onnxruntime-web/dist/` |

`predev` / `prebuild` 会自动执行同步；未找到 `AMT_DIR` 时只警告并保留已有文件。

## 部署注意

- **跨源隔离**：多线程 WASM 需要 `Cross-Origin-Opener-Policy: same-origin` 与
  `Cross-Origin-Embedder-Policy: require-corp`。Vite dev/preview 已自动添加；
  自托管静态站点也要配置同样的响应头，否则会回退到单线程（仍可用，较慢）。
- **体积**：WASM 运行时约 15 MB，低于 Cloudflare Workers 静态资源单文件 25 MiB 上限；
  WebGPU 版运行时约 29 MB，会让 `wrangler deploy` 失败，因此浏览器端固定使用多线程 WASM。
- **缓存**：`/amt/*` 建议设置长缓存（文件名固定，更新时改 `?v=` 或重新部署）。
- **移动端**：默认使用较小推理分块并限制线程，内存占用更低。
- **模型许可**：模型权重为 CC BY-NC 4.0，仅限非商业使用。
