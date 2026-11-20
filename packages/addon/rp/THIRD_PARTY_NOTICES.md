# 第三方音频素材与授权

## 本包代码许可

- 代码与脚本：**专有软件，All Rights Reserved**；仅允许最终用户安装和游玩。
- 不得再分发、改包或复用其代码/素材；授权请联系作者。
- Copyright (c) 2026 小阳x666

所有音源都在构建阶段重新裁剪、淡出、统一响度并转码为 OGG Vorbis，未改动的原始录音版权归原作者所有。实际打包的音色以 `sounds/` 目录为准。

## 标准钢琴 Standard Piano

- 音色目录：`sounds/piano*`
- 来源：FluidR3 GM 的 Acoustic Grand（program 0），作者 Frank Wen
  https://github.com/urish/cinto/blob/master/media/FluidR3%20GM.sf2
- 处理：FluidSynth 渲染指定键位，裁剪、淡出、转码。
- 授权：FluidR3 原 readme 允许自由使用与再分发并要求署名（Copyright 2000-2002 Frank Wen）。

## 经典三角 Classic Grand

- 音色目录：`sounds/classic_grand*`
- 来源：VCSL（Versilian Community Sample Library）Grand Piano, Steinway B
  https://github.com/sgossner/VCSL/tree/master/Chordophones/Zithers/Grand%20Piano%2C%20Steinway%20B
- 处理：VCSL 按全音采样，构建时取最近源音并变调到项目基准键（每 3 个半音），再裁剪、淡出、转码。
- 授权：CC0 1.0（公共领域）
  https://creativecommons.org/publicdomain/zero/1.0/
- 署名：VCSL by Versilian Studios LLC

## 明亮三角 Bright Grand

- 音色目录：`sounds/bright_grand*`
- 来源：Salamander Grand Piano V3（Yamaha C5），作者 Alexander Holm
  https://archive.org/details/SalamanderGrandPianoV3
- 处理：选取基准键、裁剪、淡出、逐键响度校准、转码。
- 授权：Creative Commons Attribution 3.0（CC BY 3.0）
  https://creativecommons.org/licenses/by/3.0/
- 署名：Salamander Grand Piano V3 by Alexander Holm. Modifications: selected
  pitches, trimmed, faded, and converted to OGG Vorbis for Minecraft Bedrock.

## 原声立式 Upright Piano

- 音色目录：`sounds/upright*`
- 来源：FreePats Upright Piano KW（2022-02-21），Kawai 立式钢琴，立体声录音
  https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html#UprightKW
- 处理：优先使用高力度层（vH），A2 / C4 使用低力度层（vL），裁剪、淡出、转码。
- 授权：CC0 1.0（公共领域）
  https://creativecommons.org/publicdomain/zero/1.0/

## 复古电钢 Electric Piano

- 音色目录：`sounds/electric_piano*`
- 来源：FreePats FM Synthesized Piano #1（2019-09-16），Hexter 模拟 Yamaha DX7 的 E.Piano 1
  https://freepats.zenvoid.org/ElectricPiano/synthesized-piano.html
- 处理：FluidSynth 渲染指定键位，裁剪、淡出、转码。
- 授权：CC0 1.0（公共领域）
  https://creativecommons.org/publicdomain/zero/1.0/
