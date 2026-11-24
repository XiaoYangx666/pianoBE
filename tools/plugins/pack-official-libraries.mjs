#!/usr/bin/env bun
/**
 * 将官方曲库（midis/library/*.pbe3）与官方精选演出（midis/performances/*.json）
 * 真正打包为标准的 `.pbeplugin` 分发包，输出到 build/plugins/。
 *
 * 原则：
 * - 插件负责分发，曲库负责组织，歌曲负责音乐，演出负责编排
 * - 演出作为独立的 performances/<songId>.json 存在于插件内，不硬焊进 PBE3 字节
 * - 不声明对 VFX 插件的硬性依赖（缺少特效插件时音乐本体仍可安装和播放）
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    compilePerformanceSource,
    computeMusicFingerprint,
    readSongHeader,
} from "@piano/core";
import { VFX_API_VERSION } from "@piano/vfx";
import { readPbePluginArchive, writePbePluginArchive } from "@piano/vfx/package";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const libraryDir = join(root, "midis", "library");
const perfDir = join(root, "midis", "performances");

const JAY_CHOU_RE =
    /周杰伦|jay\s*chou|青花瓷|花海|晴天|夜曲|稻香|兰亭序|珊瑚海|告白气球|七里香|错过的烟火|搁浅|枫|发如雪|千里之外|东风破|菊花台|一路向北|蒲公英的约定|说了再见|烟花易冷|红尘客栈|明明就|算什么男人|听妈妈的话|退后|彩虹|最长的电影|简单爱|爱在西元前|开不了口|龙卷风|轨迹|不能说的秘密|\bsecret\b|半岛铁盒|暗号|双截棍|白色风车|借口|止战之殇|夜的第七章|霍元甲|黄金甲|黑色毛衣|麦芽糖|园游会|浪漫手机|迷迭香|珊瑚海|阳光宅男|牛仔很忙|甜甜的|给我一首歌的时间|魔杰座|跨时代|超人不会飞|手写的从前|Mojito|说好不哭|等你下课|我是如此相信|最伟大的作品|红颜如霜|还在流浪/i;

const GAME_RE =
    /原神|genshin|崩坏|星穹铁道|honkai|明日方舟|arknights|东方|touhou|bad apple|undertale|deltarune|megalovania|hopes and dreams|his theme|celeste|hollow knight|泰拉瑞亚|terraria|植物大战僵尸|pvz|minecraft|c418|lena raine|pigstep|otherside|sweden|wet hands|subwoofer|aria math|马里奥|mario|塞尔达|zelda|宝可梦|pokemon|最终幻想|final fantasy|tifa|zanarkand|尼尔|nier|weight of the world|碧蓝档案|蔚蓝档案|blue archive|unwelcome school|英雄联盟|league of legends|arcane|王者荣耀|phigros|arcaea|cytus|deemo|世界计划|pjsk|恶魔城|逆转裁判|动物森友会|星露谷|艾尔登法环|黑神话|罪人的终幕|水神之舞|芙宁娜|纳西妲|钟离|雷电将军|枫丹|璃月|稻妻|须弥|蒙德|雪山|层岩|沉玉谷|提瓦特|陈致逸|hoyo-mix|yu-peng|超级马里奥|魂斗罗|洛克人|俄罗斯方块|欢乐斗地主|拳皇|仙剑奇侠传|古剑奇谭|剑网3/i;

const ANIME_FILM_RE =
    /宫崎骏|久石让|千与千寻|天空之城|龙猫|哈尔的移动城堡|菊次郎|风之谷|魔女宅急便|悬崖上的金鱼姬|幽灵公主|红猪|你的名字|天气之子|铃芽|新海诚|radwimps|前前前世|梦灯笼|火花|没什么大不了|yoasobi|夜に駆ける|夜驱|群青|アイドル|idol|勇者|米津玄师|lemon|打上花火|secret base|未闻花名|鬼灭之刃|红莲华|炎|残响散歌|进击的巨人|红莲の弓矢|咒术回战|间谍过家家|孤独摇滚|葬送的芙莉莲|刀剑神域|crossing field|四月是你的谎言|若能绽放光芒|光るなら|东京喰种|unravel|火影|青鸟|ブルーバード|灌篮高手|直到世界的尽头|好想大声说爱你|名侦探柯南|数码宝贝|butter-fly|butterfly|哆啦a梦|魔卡少女樱|eva|残酷天使|魔法少女小圆|紫罗兰永恒花园|clannad|团子大家族|鸟之诗|angel beats|一番の宝物|凉宫春日|轻音|k-on|冰菓|辉夜|死神|海贼王|we are|宾克斯的美酒|银魂|犬夜叉|穿越时空的思念|夏目友人帐|虫师|命运石之门|re0|fate|lovelive|bang dream|mygo|春日影|吉卜力|泰坦尼克|my heart will go on|加勒比海盗|he's a pirate|星际穿越|interstellar|哈利波特|hedwig|盗梦空间|time|冰雪奇缘|let it go|寻梦环游记|remember me|爱乐之城|la la land|city of stars|mia & sebastian|权力的游戏|碟中谍|007|狮子王|美女与野兽|阿拉丁|疯狂动物城|寻秦记|甄嬛|陈情令|无羁|大鱼海棠|大鱼|哪吒|白蛇|仙剑|步步惊心|三寸天堂|铠甲勇士|巴啦啦小魔仙|超兽武装|猪猪侠|喜羊羊|熊出没|迪迦|奥特曼|奇迹再现|猫和老鼠|名侦探|主题曲|片头曲|片尾曲|插曲|\bop\b|\bed\b|\bost\b/i;

const CLASSICAL_RE =
    /肖邦|chopin|贝多芬|beethoven|莫扎特|mozart|巴赫|bach|李斯特|liszt|德彪西|debussy|拉赫玛尼诺夫|rachmaninoff|舒伯特|schubert|柴可夫斯基|tchaikovsky|帕格尼尼|paganini|维瓦尔第|vivaldi|勃拉姆斯|brahms|舒曼|schumann|门德尔松|mendelssohn|萨蒂|satie|帕赫贝尔|pachelbel|卡农|canon|海顿|haydn|亨德尔|handel|格里格|grieg|拉威尔|ravel|圣桑|saint-saens|德沃夏克|dvorak|肖斯塔科维奇|普罗科菲耶夫|致爱丽丝|月光奏鸣曲|土耳其进行曲|幻想即兴曲|革命练习曲|离别曲|小狗圆舞曲|la campanella|梦中的婚礼|水边的阿狄丽娜|秋日私语|爱的罗曼史|克莱德曼|马克西姆|克罗地亚狂想曲|出埃及记|野蜂飞舞|river flows in you|kiss the rain|yiruma|坂本龙一|merry christmas mr\.? lawrence|summer|久石让.*summer|天空之城.*钢琴|g弦上的咏叹调|匈牙利舞曲|天鹅湖|胡桃夹子|四季|D大调|C大调|G大调|F大调|升c小调|降E大调|升F小调|奏鸣曲|协奏曲|练习曲|前奏曲|夜曲|圆舞曲|华尔兹|赋格|变奏曲|小夜曲|进行曲|叙事曲|谐谑曲|即兴曲|\bop\.\s*\d|\bbwv\b|\bk\.\s*\d|\bno\.\s*\d|\bsonata\b|\bconcerto\b|\bnocturne\b|\betude\b|\bwaltz\b|\bprelude\b/i;

const WESTERN_ARTIST_RE =
    /alan walker|faded|alone|spectre|thefatrat|unity|monody|xenogenesis|marshmello|avicii|wake me up|levels|taylor swift|love story|you belong with me|ed sheeran|shape of you|perfect|billie eilish|bad guy|lovely|adele|someone like you|rolling in the deep|hello|coldplay|viva la vida|yellow|fix you|the scientist|imagine dragons|believer|demons|radioactive|maroon 5|sugar|payphone|linkin park|numb|in the end|queen|bohemian rhapsody|beatles|yesterday|let it be|hey jude|michael jackson|justin bieber|charlie puth|see you again|we don't talk anymore|bruno mars|lady gaga|bad romance|katy perry|firework|roar|rihanna|diamonds|shawn mendes|onerepublic|counting stars|apologize|owl city|fireflies|rick astley|never gonna give you up|despacito|fly me to the moon|take me home|country roads|careless whisper|hotel california|canon rock|stay|sunflower|senorita|havana|dance monkey|astronomia|coffin dance|wellerman|rush e|baby shark|happy birthday|jingle bells|we wish you|silent night/i;

const CHINESE_POP_RE =
    /林俊杰|邓紫棋|薛之谦|五月天|许嵩|陈奕迅|毛不易|告五人|凤凰传奇|王菲|张学友|刘德华|张国荣|Beyond|海阔天空|光辉岁月|蔡依林|孙燕姿|梁静茹|张韶涵|张杰|华晨宇|李荣浩|赵雷|汪苏泷|徐良|本兮|邓丽君|阿桑|陈粒|陈百强|陈慧娴|陈淑桦|陈小春|八三夭|大张伟|孤勇者|起风了|富士山下|十年|红豆|后来|演员|消愁|成都|光年之外|泡沫|小幸运|那些年|体面|说散就散|海绵宝宝|可能|唯一|奢香夫人|最炫民族风|月亮之上|偏偏喜欢你|千千阙歌|甜蜜蜜|月亮代表我的心|我只在乎你|但愿人长久|倒带|说爱你|布拉格广场|一直很安静|想见你|奇妙能力歌|小半|梦醒时分|爱情转移|浮夸|好久不见/i;

const CJK_RE = /[\u4e00-\u9fff]/;

const GENRE_PRIORITY = ["game", "anime-film", "jay-chou", "chinese-pop", "western", "classical"];
const GENRE_TESTS = [
    ["game", GAME_RE],
    ["anime-film", ANIME_FILM_RE],
    ["jay-chou", JAY_CHOU_RE],
    ["chinese-pop", CHINESE_POP_RE],
    ["western", WESTERN_ARTIST_RE],
    ["classical", CLASSICAL_RE],
];

function buildPackArchive({
    pluginId,
    pluginName,
    description,
    libraryId,
    libraryName,
    songIds,
    songBytesMap,
    performancesBySong = new Map(),
}) {
    const files = new Map();
    const validSongIds = [];
    const perfIds = [];

    for (const songId of songIds) {
        const bytes = songBytesMap.get(songId);
        if (!bytes) continue;
        const header = readSongHeader(bytes);
        if (validSongIds.includes(header.id)) continue;
        validSongIds.push(header.id);
        files.set(`songs/${header.id}.pbe3`, bytes);

        const perf = performancesBySong.get(header.id);
        if (perf) {
            perfIds.push(perf.id);
            files.set(
                `performances/${header.id}.json`,
                JSON.stringify(
                    {
                        id: perf.id,
                        name: perf.name,
                        author: "PianoBE",
                        ...(perf.description ? { description: perf.description } : {}),
                        songId: header.id,
                        musicFingerprint: computeMusicFingerprint(bytes),
                        cues: perf.cues,
                    },
                    null,
                    2,
                ),
            );
        }
    }

    const capabilities = ["libraries", "songs"];
    if (perfIds.length > 0) capabilities.push("performances");

    const manifest = {
        id: pluginId,
        name: pluginName,
        version: "1.0.0",
        apiVersion: VFX_API_VERSION,
        minPianoBeVersion: "1.3.0",
        capabilities,
        author: "PianoBE",
        license: "CC-BY-NC-4.0",
        provides: {
            libraries: [libraryId],
            songs: validSongIds,
            ...(perfIds.length ? { performances: perfIds } : {}),
        },
        preview: { description },
    };

    files.set("plugin.json", `${JSON.stringify(manifest, null, 4)}\n`);
    files.set(
        `libraries/${libraryId}.json`,
        JSON.stringify(
            {
                id: libraryId,
                name: libraryName,
                description,
                author: "PianoBE",
                songs: validSongIds,
            },
            null,
            2,
        ),
    );

    const bytes = writePbePluginArchive(files);
    const verified = readPbePluginArchive(bytes);
    return { manifest: verified.manifest, bytes, archive: verified };
}

export async function packOfficialLibraries(outDir = join(root, "build/plugins")) {
    if (!existsSync(join(libraryDir, "index.json"))) {
        throw new Error(`未找到官方曲库索引：${join(libraryDir, "index.json")}`);
    }
    const indexSongs = JSON.parse(readFileSync(join(libraryDir, "index.json"), "utf8"));
    const songBytesMap = new Map();
    for (const entry of indexSongs) {
        const filePath = join(libraryDir, `${entry.id}.pbe3`);
        if (existsSync(filePath)) {
            songBytesMap.set(entry.id, new Uint8Array(readFileSync(filePath)));
        }
    }

    const performancesBySong = new Map();
    const featuredIds = [];
    if (existsSync(perfDir)) {
        for (const file of readdirSync(perfDir).sort()) {
            if (!file.endsWith(".json")) continue;
            const songId = file.replace(/\.json$/i, "");
            if (!songBytesMap.has(songId)) continue;
            const parsed = JSON.parse(readFileSync(join(perfDir, file), "utf8"));
            const cues = compilePerformanceSource(parsed, { expectedSongId: songId });
            const title = typeof parsed.title === "string" && parsed.title.trim()
                ? parsed.title.trim()
                : `${songId} 精选演出`;
            featuredIds.push(songId);
            performancesBySong.set(songId, {
                id: `pianobe.pack.featured:${songId}`,
                name: title,
                description: "PianoBE 官方精选舞台演出编排",
                cues,
            });
        }
    }

    const buckets = new Map([
        ["jay-chou", []],
        ["chinese-pop", []],
        ["game", []],
        ["anime-film", []],
        ["classical", []],
        ["western", []],
    ]);

    for (const entry of indexSongs) {
        if (!songBytesMap.has(entry.id)) continue;
        const name = String(entry.name ?? "");
        const matched = GENRE_TESTS.filter(([, re]) => re.test(name)).map(([key]) => key);
        if (matched.length > 0) {
            const genre = GENRE_PRIORITY.find((key) => matched.includes(key)) ?? matched[0];
            buckets.get(genre).push(entry.id);
        } else {
            buckets.get(CJK_RE.test(name) ? "chinese-pop" : "western").push(entry.id);
        }
    }

    const specs = [
        {
            pluginId: "pianobe.pack.featured",
            pluginName: "官方精选演出包",
            description: "7 首官方编排舞台演出的精选曲目与独立演出脚本（需搭配对应特效插件呈现完整舞台效果）",
            libraryId: "official:featured",
            libraryName: "精选演出",
            songIds: featuredIds,
            performancesBySong,
        },
        {
            pluginId: "pianobe.pack.jay-chou",
            pluginName: "周杰伦精选曲库",
            description: "精选周杰伦热门钢琴改编曲目合集",
            libraryId: "official:jay-chou",
            libraryName: "周杰伦精选",
            songIds: buckets.get("jay-chou"),
        },
        {
            pluginId: "pianobe.pack.chinese-pop",
            pluginName: "华语流行曲库",
            description: "华语经典与当代流行钢琴曲目合集",
            libraryId: "official:chinese-pop",
            libraryName: "华语流行",
            songIds: buckets.get("chinese-pop"),
        },
        {
            pluginId: "pianobe.pack.game",
            pluginName: "游戏音乐曲库",
            description: "原神、崩坏、Minecraft、东方与各大游戏原声合集",
            libraryId: "official:game",
            libraryName: "游戏音乐",
            songIds: buckets.get("game"),
        },
        {
            pluginId: "pianobe.pack.anime-film",
            pluginName: "影视与动漫曲库",
            description: "吉卜力、新海诚、经典动画与影视配乐合集",
            libraryId: "official:anime-film",
            libraryName: "影视与动漫",
            songIds: buckets.get("anime-film"),
        },
        {
            pluginId: "pianobe.pack.classical",
            pluginName: "古典钢琴曲库",
            description: "古典大师名曲、浪漫派与现代钢琴独奏合集",
            libraryId: "official:classical",
            libraryName: "古典钢琴",
            songIds: buckets.get("classical"),
        },
        {
            pluginId: "pianobe.pack.western",
            pluginName: "欧美音乐曲库",
            description: "欧美流行、电音与海外经典钢琴曲目合集",
            libraryId: "official:western",
            libraryName: "欧美音乐",
            songIds: buckets.get("western"),
        },
    ];

    mkdirSync(outDir, { recursive: true });
    const results = [];
    for (const spec of specs) {
        if (!spec.songIds.length) continue;
        const { manifest, bytes } = buildPackArchive({
            ...spec,
            songBytesMap,
        });
        const outPath = join(outDir, `${manifest.id}.pbeplugin`);
        writeFileSync(outPath, bytes);
        console.log(
            `[pack-official] ${manifest.id} v${manifest.version} -> ${outPath} (${(bytes.byteLength / 1024).toFixed(1)} KB, ${spec.songIds.length} songs)`,
        );
        results.push({ id: manifest.id, bytes, songCount: spec.songIds.length });
    }
    return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const args = process.argv.slice(2);
    let outDir = join(root, "build/plugins");
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--out" && args[i + 1]) {
            outDir = resolve(root, args[++i]);
        }
    }
    await packOfficialLibraries(outDir);
}
