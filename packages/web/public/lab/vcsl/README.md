# VCSL 实验采样

本目录由 `tools/audio/build-audio-lab-assets.mjs` 生成，仅用于 Web Audio Lab 实验，不进入正式音色包。

- 来源：VCSL（Versilian Community Sample Library）— Grand Piano, Steinway B
  https://github.com/sgossner/VCSL
- 使用力度层：vl2 / vl3 / vl4（正式音色 `classic_grand` 只用 vl3）
- 处理：按基础键变调、截取 4s、0.5s 淡出、44.1kHz 立体声 OGG；每层单独测量并记录响度偏移。
- 授权：CC0 1.0（公共领域）
  https://creativecommons.org/publicdomain/zero/1.0/
- 致谢：VCSL by Versilian Studios LLC

`manifest.json` 记录每个键的源音、变调、基础增益与三层响度，浏览器与离线分析共用。
