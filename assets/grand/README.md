# Nocturne Concert Grand

整模以 Steinway D-274 音乐会三角钢琴为比例参考。官方欧洲站标注琴长 274 cm、琴宽 157 cm。模型按电子琴的比例每格对应 65 cm，外廓约宽 2.42 格、深 4.22 格，白键面离地约 0.96 格。落地网格为 3 × 5 格，开盖占用 3 层，外壳保留直的低音侧和向内收的高音侧。曲线、谱架与内部机械细节按照片做了适合基岩版方块的简化。[官方尺寸](https://eu.steinway.com/en/pianos/grand-pianos/d-274) · [铸铁板、交叉琴弦与三踏板规格](https://www.steinway.com/pianos/steinway/grand/model-d) · [开盖参考照片](https://commons.wikimedia.org/wiki/File:Steinway_concert_grand_piano_D-274.jpg)

- [Blockbench 整模](./grand_full.bbmodel)包含内嵌贴图。编辑从这里开始。
- [分块重拼工程](./cut/grand_reassembled.bbmodel)可在 Blockbench 中对照整模。独立分块位于 `cut/`，对应的基岩版几何位于 `bedrock/`。
- [格位索引](./cut-map.json)按 Blockbench 的 X/Y/Z 给出格偏移，原点是琴键一端的底层中央格。琴键朝 −Z。每格工程以格底中心为局部原点，导出的原生几何按现有钢琴的规则反射 X。

在仓库根目录运行 `python tools/model-grand.py cut` 可从保存的整模重切。首次生成整模使用 `python tools/model-grand.py author`，依赖 Python 3 和 Pillow。切割保留外表面 UV 的对应区域，隐藏新切出的内部面。

`python tools/publish-grand.py` 将已裁好的模型发布到附加包，并生成琴键、谱架和交互范围。用「三角钢琴」物品放置，琴键朝向玩家。点击琴键直接弹奏，点击琴键后方中央的琴身打开完整面板，再从面板进入 MIDI 播放器或钢琴设置。前排的侧颊、下沿和琴尾不触发面板。

三角钢琴和 P-88 都可在「钢琴设置」中打开或关闭「安装谱架和曲谱」，默认关闭。三角钢琴用键盖后方的宽托板，P-88 用琴身后沿的窄插架。两款向后倾斜的谱架和《小星星》曲谱由零碰撞的 `xypiano:grand_score` 显示实体渲染。每页用粗体简谱显示三小节旋律，横线表示前一个音延长一拍。看向右页按一次潜行翻到后一组，看向左页按潜行翻回第一组。

曲谱原型目前内置四页《小星星》。展开钢琴面板后，也可以打开输入框下方的「显示《小星星》简谱」。面板使用独立的横版图片，按上一页或下一页翻页，可在同一个面板里继续打字弹奏。

「粒子样式」中可以试用「樱吹雪」「星火」和「棱光」。主特效沿琴键后侧的发射线升起，键面短微光单独播放。
