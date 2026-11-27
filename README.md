# PianoBE

Minecraft 基岩版钢琴附加包。可以在游戏里实时弹奏、播放 MIDI、布置多架钢琴，并为曲目搭配音色、曲谱和粒子特效。

**[打开 PianoBE 在线工作台](https://pianobe.2408807389.workers.dev)** · [B 站演示](https://www.bilibili.com/video/BV1jLD9BzE5D) · [交流群](https://qm.qq.com/q/KUgqkHM5uS)

![PianoBE 游戏画面](./screenshot.png)

## 在自己的世界里玩

**PianoBE 2.0 是破坏性更新。** 请在新世界安装，1.x 世界中的钢琴、音乐存储卡和已导入曲目没有升级迁移流程。BDS 也请使用新世界。

当前源码构建要求 **Minecraft 基岩版 26.60 或更新版本**。世界需要开启「测试版 API」。

1. 打开在线工作台，在「音乐库」选择「从官方曲包添加」，或者拖入自己的 `.mid` / `.pbe3` 文件。
2. 勾选曲目并点「导出附加包」。在「附加包」页可以调整包名和曲目，也可以在「扩展中心」安装想用的音色或演出插件。最后点「导出 .mcaddon」。
3. 用 Minecraft 打开下载的 `.mcaddon`。创建或编辑世界时启用导入的行为包和资源包，再开启「测试版 API」。
4. 进入世界后从创造物品栏取出钢琴，放下并交互打开面板。手动弹奏使用面板上的输入框，播放歌曲进入「MIDI 播放器」。

单机和普通联机世界使用工作台导出的内嵌曲库包即可。使用带远程曲库的 BDS 专用包时，请按下节配置后端。

## 给已安装的世界加歌

在工作台的「音乐工具」打开「MIDI / PBE3 检查与导入码」，导入文件并生成分段导入码。在游戏内手持音乐存储卡与钢琴交互插卡，再打开「MIDI 播放器」→「导入 MIDI」，按顺序粘贴各段。服主可以用 `/pbe:pbe_setting` 给普通玩家开启导入权限。

## BDS 服主

想从服务器集中管理曲目、音色和插件，可以运行 PianoBE 后端，然后在管理页上传曲目并部署 BDS 附加包。

目前 GitHub Releases 暂无预编译后端。已有后端程序的服主可直接启动，也可按服主指南使用 Docker 从源码构建。普通世界可直接使用在线工作台。

1. 按[服主部署指南](packages/server/README.md#服主快速开始)启动后端并使用管理员令牌登录。指南列出了各启动方式的令牌文件位置。
2. 打开「附加包」→「BDS 部署与校验」，填写 BDS 根目录和世界，点「保存 BDS 配置」后再点「部署到 BDS」。后端需要能写入 BDS 目录。两者分开部署时，可点「下载配套 .mcaddon」后手动安装到 BDS。
3. 在 BDS 的 `config/default/variables.json` 中设置 `pianoBackendUrl`，地址须能从 BDS 访问。到管理页创建一个普通令牌，在 `config/default/secrets.json` 中将 `pianoBackendToken` 写为 `Bearer <令牌>`。重启 BDS 后，从游戏里的「MIDI 播放器」打开曲库。详见[BDS 配置示例](packages/addon/README.md#bds-配置配置文件示例)。

## 反馈与贡献

反馈安装或游玩问题时，请附上游戏版本、设备平台、操作步骤和报错截图。也可以通过[问题区](https://github.com/XiaoYangx666/pianoBE/issues)反馈。

源码构建、测试和曲库贡献步骤见[开发与贡献指南](docs/development.md)。

## 许可证

- **除 addon 外的代码**（`core` / `studio` / `server` / `web` / `ui`）：
  **CC BY-NC 4.0**（与 AMT 模型一致，见 [`LICENSE`](LICENSE)）——允许非商业使用、修改和再分发，
  **禁止商业使用**，再分发需保留署名。
- **`packages/addon`**：专有软件，**All Rights Reserved**（见 [`packages/addon/LICENSE`](packages/addon/LICENSE)）。
  仅允许最终用户安装和游玩，不得再分发、改包或复用其代码/素材；商业授权或其他授权请联系作者。
- 第三方模型与运行时：见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。AMT 模型为
  **CC BY-NC 4.0**，仅限非商业使用，需保留署名。
