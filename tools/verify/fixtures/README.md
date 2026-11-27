# 验证用样例 MIDI

`verify-generator.mjs` 需要两首真实曲目的 `.mid` 走完整链路（转换 → PBE3 → 装配 → 回读）。
`midis/files/` 是本地原始 MIDI 目录、不入库，所以这里放两份固定样例：

| 文件 | 用途 |
|---|---|
| `Beyond - 海阔天空.mid` | 曲目 A，历史 id 校验（`4beea226`） |
| `ChiliChill - 让风告诉你.mid` | 曲目 B，新增曲目与演出提示校验 |

它们只是测试输入，不是曲库的源数据；曲库本身仍在 `midis/library/`。
新增/修改样例会改变 CRC 派生的曲目 id，需要同步更新脚本里的断言。
