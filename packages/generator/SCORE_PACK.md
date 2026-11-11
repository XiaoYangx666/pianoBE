# 曲谱包格式（score-pack）

生成器支持在模板已有曲谱之外，再导入自定义曲谱。曲谱包是一个 `.zip` 文件，导入后会同时生成：

- 游戏内 DDUI 面板使用的单页 A4 竖版纹理
- 谱架实体使用的 1024×1024 纹理
- `scorePack.js` 曲谱数据模块
- RP 实体纹理表、render controller 纹理数组与 BP 实体 `xypiano:score_variant` 范围

整个 addon 最终最多 **16 张曲谱**（模板已有 + 新导入）。超过上限时整包拒绝导入。

> 除了 `.zip` 曲谱包，生成器还支持直接导入真实谱面图片 / PDF（按原样缩放，不重新排版）。规则、单页面板图与谱架 4 页限制见 [IMPORT_PAGES.md](./IMPORT_PAGES.md)。

## 目录结构

`score-pack.json` 可以放在压缩包根目录，也可以整个包放在一个顶层文件夹内：

```text
score-pack.json
pages/...
stand/...        # 可选
```

```text
my-score-pack/
    score-pack.json
    pages/...
    stand/...
```

图片路径相对于 `score-pack.json` 所在目录。支持 PNG / JPEG / WebP 等浏览器可解码的格式，导出时统一转为 PNG。

## score-pack.json

```json
{
  "format": "pianobe.score-pack",
  "version": 1,
  "scores": [
    {
      "id": "twinkle",
      "title": "小星星",
      "pages": ["pages/twinkle/1.png", "pages/twinkle/2.png"],
      "standPages": ["stand/twinkle/1.png", "stand/twinkle/2.png"]
    }
  ]
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `format` | 是 | 固定为 `pianobe.score-pack` |
| `version` | 是 | 固定为 `1` |
| `scores` | 是 | 曲谱数组，至少 1 项 |
| `id` | 否 | 小写稳定 id，匹配 `/^[a-z0-9][a-z0-9_-]{0,31}$/`，在 addon 内唯一。省略时由标题生成 ASCII slug，冲突时自动追加 `-2`、`-3` 等后缀；显式填写但冲突会报错 |
| `title` | 是 | 显示名称，不能为空，最长约 24 个全角字符 |
| `pages` | 是 | DDUI 面板页面图片，至少 1 张 |
| `standPages` | 否 | 谱架页面图片，缺省时使用 `pages`；最多取前 4 张上谱架 |

一个曲谱包可以包含多张曲谱，也可以一次选择多个 `.zip` 导入。显式 `id` 与已有曲谱冲突、图片无法解码、超过 16 张等情况都会用中文提示拒绝。

## 图片尺寸与谱架槽位

### DDUI 面板页面

`.zip` 曲谱包中每张页面统一输出为 **1280×1810** PNG（接近 A4 竖版比例）：

- 纸张底色 `#FFFBEB`（RGB 255,251,235）
- 原图按 contain 缩放并居中
- 输出路径：`textures/ui/piano_score/<id>/page_<n>.png`
- 面板一次显示一页，多页时用「上一页 / 下一页」翻页
- 灰阶谱面输出 16 级灰度、4 位 PNG；彩色谱面退回 32 色

直接导入图片/PDF 的曲谱使用同一套规则，见 [IMPORT_PAGES.md](./IMPORT_PAGES.md)。

### 谱架纹理

每个曲谱生成一张 **1024×1024** PNG：

- 整张画布填充纸张底色 `#FFFBEB`
- 底部绘制谱架木条/挡板使用的硬件 UV 条带（与 `tools/grand_score.py` 的 `paint_hardware` 一致）：
  - `x=0..25`、`y=959..984`，逐行从 `(49,54,60)` 线性渐变到 `(25,28,34)`
  - `x=64..89`、`y=959..984`，逐行从 `(60,64,69)` 线性渐变到 `(36,38,42)`
- 2×2 共 4 个竖版页面槽位，坐标固定：

| 槽位 | 坐标 | 尺寸 |
| --- | --- | --- |
| page 0 | (0, 0) | 352×456 |
| page 1 | (352, 0) | 352×456 |
| page 2 | (0, 456) | 352×456 |
| page 3 | (352, 456) | 352×456 |

- 每个槽位按 contain 缩放并居中
- 不足 4 页的槽位保留空白纸张
- 输出路径：`textures/entity/piano_score/<id>.png`

## 导出后的 addon 文件

生成器会在导出时重写以下内容：

- `BP/scripts/packages/addon/src/data/scorePack.js`

  ```js
  export const SCORE_RESOURCE_PACK_ID = "<RP header UUID>";
  export const PIANO_SCORES = [
    {
      "id": "my-score",
      "title": "我的曲谱",
      "pageCount": 2,
      "pages": [
        "textures/ui/piano_score/my-score/page_1.png",
        "textures/ui/piano_score/my-score/page_2.png"
      ]
    }
  ];
  ```

- `RP/textures/ui/piano_score/<id>/page_<n>.png`（单页 A4 竖版预览）
- `RP/textures/entity/piano_score/<id>.png`
- `RP/entity/grand_score.entity.json`

  `minecraft:client_entity.description.textures` 会被写成 `default` + 每张曲谱一个 `score_<n>`（键名不使用曲谱 id，避免连字符等非法标识符）：

  ```json
  {
    "default": "textures/entity/piano_score/<id0>",
    "score_0": "textures/entity/piano_score/<id0>",
    "score_1": "textures/entity/piano_score/<id1>"
  }
  ```

- `RP/render_controllers/grand_score.render_controllers.json`

  `controller.render.xypiano.grand_score` 的 `arrays.textures["Array.scores"]` 与 `textures` 会被同步更新，顺序与 `PIANO_SCORES` 一致；`part_visibility` 等其它字段保持不变：

  ```json
  {
    "arrays": {
      "textures": {
        "Array.scores": ["Texture.score_0", "Texture.score_1"]
      }
    },
    "geometry": "Geometry.default",
    "materials": [{ "*": "Material.default" }],
    "textures": ["Array.scores[q.property('xypiano:score_variant')]"],
    "part_visibility": [
      { "grand_*": "q.property('xypiano:score_grand')" }
    ]
  }
  ```

  上面 `part_visibility` 仅为示意，实际会保留模板中的完整内容。

- `BP/entities/grand_score.json`

  `minecraft:entity.description.properties["xypiano:score_variant"]` 会被写成：

  ```json
  {
    "type": "int",
    "range": [0, 1],
    "default": 0,
    "client_sync": true
  }
  ```

  实体 JSON 的其它字段保持不变。

模板已有曲谱的纹理直接复用模板中的原始字节，不会重新编码；导出前会清空并重建 `textures/ui/piano_score/` 与 `textures/entity/piano_score/` 两个目录。

如果导出时没有提供曲谱列表，生成器只替换 `SCORE_RESOURCE_PACK_ID`，保留模板原有的 `PIANO_SCORES` 与曲谱纹理，避免旧调用把模板曲谱数据清空。
