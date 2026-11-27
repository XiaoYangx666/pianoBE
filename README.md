# PianoBE

**让 Minecraft 基岩版拥有一架可以实时演奏、播放 MIDI，并能搭配舞台视觉演出的钢琴。**

PianoBE 是一个面向 Minecraft Bedrock Edition 的钢琴附加包与配套创作工作台。你可以在游戏中弹奏钢琴、播放 MIDI 音乐、管理曲库，也可以通过插件为歌曲组合不同音色、舞台主题、粒子和特效。

**[打开 PianoBE Studio](https://piano.mcxfj.top/)** · [B 站演示视频](https://www.bilibili.com/video/BV1jLD9BzE5D) · [交流群](https://qm.qq.com/q/KUgqkHM5uS) · [问题反馈](https://github.com/XiaoYangx666/pianoBE/issues)

## PianoBE 2.0 有什么？

### 游戏内钢琴

- 可交互的立式电子琴与三角钢琴模型，琴键可以实际演奏。
- 支持通过游戏内面板输入音符，也可以播放 MIDI 曲目。
- 提供五套音色：标准钢琴、经典三角钢琴、明亮三角钢琴、原声立式钢琴和复古电钢。
- 支持力度响应、音量调节和独立的钢琴运行时。

### MIDI 播放与音乐管理

- 支持 MIDI 曲目转换为 PianoBE 使用的 PBE3 格式。
- 提供曲库浏览、搜索、播放队列、播放列表和播放进度控制。
- 支持暂停、继续、跳转和从曲库选择歌曲。
- 支持音乐存储卡与游戏内导入码，方便把自定义曲目带入已有世界。
- 支持内嵌曲库；BDS 专用包还可以连接自托管后端使用远程曲库。

### 插件化舞台与视觉演出

PianoBE 不只是 MIDI 播放器。歌曲可以携带自己的演出编排，也可以组合公共扩展能力：

- **音色扩展**：添加不同钢琴音色与采样。
- **视觉特效**：粒子、画笔、光效和演出特效。
- **舞台主题**：切换舞台氛围、灯光与视觉布局。
- **歌曲与演出**：为曲目提供专属演出，也可以只播放普通 MIDI。
- **按需组合**：歌曲不必强制依赖某一套特效；导出时选择需要的插件即可。

### PianoBE Studio

[PianoBE Studio](https://piano.mcxfj.top/) 是配套的 Web 工作台，用来准备曲库和制作附加包：

- 从官方曲包添加歌曲，或导入自己的 MIDI / PBE3 文件。
- 管理音乐库、曲目和扩展插件。
- 选择要导出的歌曲、音色与演出插件。
- 自定义附加包信息并导出 `.mcaddon`。
- 在浏览器本地进行音频转 MIDI，生成可导入游戏的曲目。
- 生成 MIDI / PBE3 分段导入码，给已经安装的世界添加歌曲。

## 快速开始

### 环境要求

- Minecraft Bedrock Edition **26.60 或更新版本**。
- 创建世界时开启「测试版 API」。
- 同时启用 PianoBE 行为包与资源包。

### 安装与游玩

1. 打开 [PianoBE Studio](https://piano.mcxfj.top/)。
2. 在「音乐库」中选择「从官方曲包添加」，或者导入自己的 `.mid` / `.pbe3` 文件。
3. 在「扩展中心」安装需要的音色或演出插件，然后到「附加包」页面确认内容并导出 `.mcaddon`。
4. 使用 Minecraft 打开导出的附加包。
5. 创建新世界，启用导入的行为包和资源包，并开启「测试版 API」。
6. 进入世界后从创造物品栏取出钢琴，放置并交互打开面板。手动演奏可以使用面板上的输入框；播放歌曲则进入「MIDI 播放器」。

单机和普通联机世界使用工作台导出的内嵌曲库包即可。使用远程曲库的 BDS 专用包时，请按下方的服主指南配置后端。

### 使用歌曲演出

如果歌曲带有演出编排，从「播放列表 → 添加歌曲」加入时会自动选择第一个可用演出。也可以打开歌曲详情，在「演奏方式」中选择其他演出或普通演奏。

导出附加包前，请确认已经安装该演出所需的特效扩展。

### 音频转 MIDI

在 Studio 的「音乐工具」中下载转录资源，然后选择音频文件即可开始转录。推理在浏览器本地运行，资源缓存后可以重复使用。

## 给已经安装的世界添加歌曲

不需要重新导出整个附加包，也可以通过分段导入码给已有世界添加曲目：

1. 在 Studio「音乐工具」中打开「MIDI / PBE3 检查与导入码」。
2. 导入文件并生成分段导入码。
3. 在游戏中手持音乐存储卡与钢琴交互，将存储卡插入钢琴。
4. 打开「MIDI 播放器」→「导入 MIDI」，按顺序粘贴各段导入码。

服主可以通过游戏命令 `/pbe:pbe_setting` 为普通玩家开启导入权限。

## BDS 服务器

PianoBE 提供独立的自托管后端，供服主集中管理远程曲库、插件和服务器附加包：

- 管理远程音乐库与玩家访问令牌。
- 管理外置插件、音色和曲目扩展。
- 在管理页面装配并部署 BDS 专用行为包与资源包。
- 运行服务端音频转 MIDI 任务。
- 支持 Docker 部署，也支持 Windows / Linux 单文件服务端程序。

目前 GitHub Releases 暂无预编译后端。已有后端程序的服主可以直接启动；也可以按后端指南从源码构建 Docker 镜像。

1. 按照[服主部署指南](packages/server/README.md#服主快速开始)启动后端，并使用管理员令牌登录。
2. 在管理页「附加包」→「BDS 部署与校验」中填写 BDS 根目录和世界名称，保存配置后部署。后端需要能够写入 BDS 目录；如果后端与 BDS 分开部署，也可以下载配套 `.mcaddon` 后手动安装。
3. 在 BDS 的 `config/default/variables.json` 中设置 `pianoBackendUrl`，确保该地址可从 BDS 访问；在管理页创建普通令牌，并在 `config/default/secrets.json` 中将 `pianoBackendToken` 设置为 `Bearer <令牌>`。重启 BDS 后，即可从游戏内 MIDI 播放器打开远程曲库。

详细配置见[BDS 配置示例](packages/addon/README.md#bds-配置配置文件示例)。

## 文档

- [Addon 使用与 BDS 配置](packages/addon/README.md)
- [后端部署与配置](packages/server/README.md)
- [开发、构建与贡献指南](docs/development.md)
- [VFX 舞台视觉系统](docs/vfx/README.md)

## 版本与升级说明

**PianoBE 2.0 是一次破坏性更新。**

2.0 不提供 1.x 世界数据迁移流程。旧版本世界中的钢琴、音乐存储卡和已导入曲目不能直接迁移。请在新世界中安装 2.0；BDS 也需要使用新世界。

## 反馈与贡献

遇到安装或游玩问题时，请通过 [GitHub Issues](https://github.com/XiaoYangx666/pianoBE/issues) 反馈，并尽量附上游戏版本、设备平台、复现步骤和报错截图。

源码构建、测试和曲库贡献方式见[开发与贡献指南](docs/development.md)。

## 许可证

- **除 `packages/addon` 外的代码**（Core、Studio、Server、Web、UI 等）：[CC BY-NC 4.0](LICENSE)，允许非商业使用、修改和再分发，需保留署名；禁止商业使用。
- **`packages/addon`**：专有软件，All Rights Reserved。仅允许最终用户安装和游玩，不得再分发、改包或复用其代码与素材。商业授权及其他授权请联系作者。详见 [Addon LICENSE](packages/addon/LICENSE)。
- 第三方模型、音色和运行时依赖遵循各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
