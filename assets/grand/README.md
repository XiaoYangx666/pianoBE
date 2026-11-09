# Nocturne Concert Grand

整模以 Steinway D-274 音乐会三角钢琴为比例参考。官方欧洲站标注琴长 274 cm、琴宽 157 cm。模型按电子琴的比例每格对应 65 cm，外廓约宽 2.42 格、深 4.22 格，白键面离地约 0.96 格。落地网格为 3 × 5 格，开盖占用 3 层，外壳保留直的低音侧和向内收的高音侧。曲线、谱架与内部机械细节按照片做了适合基岩版方块的简化。[官方尺寸](https://eu.steinway.com/en/pianos/grand-pianos/d-274) · [铸铁板、交叉琴弦与三踏板规格](https://www.steinway.com/pianos/steinway/grand/model-d) · [开盖参考照片](https://commons.wikimedia.org/wiki/File:Steinway_concert_grand_piano_D-274.jpg)

- [Blockbench 整模](./grand_full.bbmodel)包含内嵌贴图。编辑从这里开始。
- [分块重拼工程](./cut/grand_reassembled.bbmodel)可在 Blockbench 中对照整模。独立分块位于 `cut/`，对应的基岩版几何位于 `bedrock/`。
- [格位索引](./cut-map.json)按 Blockbench 的 X/Y/Z 给出格偏移，原点是琴键一端的底层中央格。琴键朝 −Z。每格工程以格底中心为局部原点，导出的原生几何按现有钢琴的规则反射 X。

在仓库根目录运行 `python tools/model-grand.py cut` 可从保存的整模重切。首次生成整模使用 `python tools/model-grand.py author`，依赖 Python 3 和 Pillow。切割保留外表面 UV 的对应区域，隐藏新切出的内部面。

`python tools/publish-grand.py` 将已裁好的模型发布到附加包，并从同一整模生成琴键动画几何及交互范围。游戏里用原有「钢琴」物品放置，琴键朝向玩家，琴尾向前延伸。琴键上方的 KEYS、MIDI、SET 三个按钮分别打开弹奏面板、MIDI 播放器和设置。存档中已摆放的电子琴继续使用原来的模型。
