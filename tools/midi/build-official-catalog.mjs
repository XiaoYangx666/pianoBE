#!/usr/bin/env bun
/**
 * 根据 midis/library/index.json 与 midis/performances/*.json
 * 生成官方在线曲库分类目录：midis/library/catalog.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const libraryDir = path.join(root, "midis", "library");
const perfDir = path.join(root, "midis", "performances");

const indexPath = path.join(libraryDir, "index.json");
const songs = JSON.parse(fs.readFileSync(indexPath, "utf8"));

function extractEffectsFromPerformanceJson(data) {
    const effects = new Set();
    const collect = (cues) => {
        if (!Array.isArray(cues)) return;
        for (const cue of cues) {
            if (cue && typeof cue.effect === "string" && cue.effect) {
                effects.add(cue.effect);
            }
        }
    };
    collect(data?.cues);
    if (Array.isArray(data?.sections)) {
        for (const sec of data.sections) collect(sec?.cues);
    }
    return [...effects].sort();
}

const performanceMap = {};
const featuredSongIds = [];

if (fs.existsSync(perfDir)) {
    for (const file of fs.readdirSync(perfDir).sort()) {
        if (!file.endsWith(".json")) continue;
        const songId = file.replace(/\.json$/i, "");
        const parsed = JSON.parse(fs.readFileSync(path.join(perfDir, file), "utf8"));
        const requiredEffects = extractEffectsFromPerformanceJson(parsed);
        featuredSongIds.push(songId);
        performanceMap[songId] = [
            {
                id: `official:${songId}`,
                name: typeof parsed.title === "string" && parsed.title ? parsed.title : `${songId} 精选演出`,
                author: "PianoBE",
                songId,
                requiredEffects,
                origin: { kind: "official", id: "featured-performances", name: "精选演出" },
            },
        ];
    }
}

const GAME_RE =
    /原神|genshin|崩坏|星穹铁道|honkai|明日方舟|arknights|东方|touhou|bad apple|undertale|deltarune|megalovania|hopes and dreams|his theme|celeste|hollow knight|泰拉瑞亚|terraria|植物大战僵尸|pvz|minecraft|c418|lena raine|pigstep|otherside|sweden|wet hands|subwoofer|aria math|马里奥|mario|塞尔达|zelda|宝可梦|pokemon|最终幻想|final fantasy|tifa|zanarkand|尼尔|nier|weight of the world|碧蓝档案|蔚蓝档案|blue archive|unwelcome school|英雄联盟|league of legends|arcane|王者荣耀|phigros|arcaea|cytus|deemo|世界计划|pjsk|恶魔城|逆转裁判|动物森友会|星露谷|艾尔登法环|黑神话|罪人的终幕|水神之舞|芙宁娜|纳西妲|钟离|雷电将军|枫丹|璃月|稻妻|须弥|蒙德|雪山|层岩|沉玉谷|提瓦特|陈致逸|hoyo-mix|yu-peng|超级马里奥|魂斗罗|洛克人|俄罗斯方块|欢乐斗地主|拳皇|仙剑奇侠传|古剑奇谭|剑网3/i;

const ANIME_FILM_RE =
    /宫崎骏|久石让|千与千寻|天空之城|龙猫|哈尔的移动城堡|菊次郎|风之谷|魔女宅急便|悬崖上的金鱼姬|幽灵公主|红猪|你的名字|天气之子|铃芽|新海诚|radwimps|前前前世|梦灯笼|火花|没什么大不了|yoasobi|夜に駆ける|夜驱|群青|アイドル|idol|勇者|米津玄师|lemon|打上花火|secret base|未闻花名|鬼灭之刃|红莲华|炎|残响散歌|进击的巨人|红莲の弓矢|咒术回战|间谍过家家|孤独摇滚|葬送的芙莉莲|刀剑神域|crossing field|四月是你的谎言|若能绽放光芒|光るなら|东京喰种|unravel|火影|青鸟|ブルーバード|灌篮高手|直到世界的尽头|好想大声说爱你|名侦探柯南|数码宝贝|butter-fly|butterfly|哆啦a梦|魔卡少女樱|eva|残酷天使|魔法少女小圆|紫罗兰永恒花园|clannad|团子大家族|鸟之诗|angel beats|一番の宝物|凉宫春日|轻音|k-on|冰菓|辉夜|死神|海贼王|we are|宾克斯的美酒|银魂|犬夜叉|穿越时空的思念|夏目友人帐|虫师|命运石之门|re0|fate|lovelive|bang dream|mygo|春日影|吉卜力|泰坦尼克|my heart will go on|加勒比海盗|he's a pirate|星际穿越|interstellar|哈利波特|hedwig|盗梦空间|time|冰雪奇缘|let it go|寻梦环游记|remember me|爱乐之城|la la land|city of stars|mia & sebastian|权力的游戏|碟中谍|007|狮子王|美女与野兽|阿拉丁|疯狂动物城|寻秦记|甄嬛|陈情令|无羁|大鱼海棠|大鱼|哪吒|白蛇|仙剑|步步惊心|三寸天堂|铠甲勇士|巴啦啦小魔仙|超兽武装|猪猪侠|喜羊羊|熊出没|迪迦|奥特曼|奇迹再现|猫和老鼠|名侦探|主题曲|片头曲|片尾曲|插曲|\bop\b|\bed\b|\bost\b/i;

const CLASSICAL_RE =
    /肖邦|chopin|贝多芬|beethoven|莫扎特|mozart|巴赫|bach|李斯特|liszt|德彪西|debussy|拉赫玛尼诺夫|rachmaninoff|舒伯特|schubert|柴可夫斯基|tchaikovsky|帕格尼尼|paganini|维瓦尔第|vivaldi|勃拉姆斯|brahms|舒曼|schumann|门德尔松|mendelssohn|萨蒂|satie|帕赫贝尔|pachelbel|卡农|canon|海顿|haydn|亨德尔|handel|格里格|grieg|拉威尔|ravel|圣桑|saint-saens|德沃夏克|dvorak|肖斯塔科维奇|普罗科菲耶夫|致爱丽丝|月光奏鸣曲|土耳其进行曲|幻想即兴曲|革命练习曲|离别曲|小狗圆舞曲|la campanella|梦中的婚礼|水边的阿狄丽娜|秋日私语|爱的罗曼史|克莱德曼|马克西姆|克罗地亚狂想曲|出埃及记|野蜂飞舞|river flows in you|kiss the rain|yiruma|坂本龙一|merry christmas mr\.? lawrence|summer|久石让.*summer|天空之城.*钢琴|g弦上的咏叹调|匈牙利舞曲|天鹅湖|胡桃夹子|四季|D大调|C大调|G大调|F大调|升c小调|降E大调|升F小调|奏鸣曲|协奏曲|练习曲|前奏曲|夜曲|圆舞曲|华尔兹|赋格|变奏曲|小夜曲|进行曲|叙事曲|谐谑曲|即兴曲|\bop\.\s*\d|\bbwv\b|\bk\.\s*\d|\bno\.\s*\d|\bsonata\b|\bconcerto\b|\bnocturne\b|\betude\b|\bwaltz\b|\bprelude\b/i;

const WESTERN_ARTIST_RE =
    /alan walker|faded|alone|spectre|thefatrat|unity|monody|xenogenesis|marshmello|avicii|wake me up|levels|taylor swift|love story|you belong with me|ed sheeran|shape of you|perfect|billie eilish|bad guy|lovely|adele|someone like you|rolling in the deep|hello|coldplay|viva la vida|yellow|fix you|the scientist|imagine dragons|believer|demons|radioactive|maroon 5|sugar|payphone|linkin park|numb|in the end|queen|bohemian rhapsody|beatles|yesterday|let it be|hey jude|michael jackson|justin bieber|charlie puth|see you again|we don't talk anymore|bruno mars|lady gaga|bad romance|katy perry|firework|roar|rihanna|diamonds|shawn mendes|onerepublic|counting stars|apologize|owl city|fireflies|rick astley|never gonna give you up|despacito|faded|fly me to the moon|take me home|country roads|carless whisper|careless whisper|hotel california|canon rock|stay|faded|sunflower|senorita|havana|dance monkey|astronomia|coffin dance|wellerman|rush e|baby shark|happy birthday|jingle bells|we wish you|silent night/i;

const CHINESE_POP_RE =
    /周杰伦|林俊杰|邓紫棋|薛之谦|五月天|许嵩|陈奕迅|毛不易|告五人|凤凰传奇|王菲|张学友|刘德华|张国荣|Beyond|海阔天空|光辉岁月|蔡依林|孙燕姿|梁静茹|张韶涵|张杰|华晨宇|李荣浩|赵雷|汪苏泷|徐良|本兮|邓丽君|阿桑|陈粒|陈百强|陈慧娴|陈淑桦|陈小春|八三夭|大张伟|青花瓷|花海|晴天|夜曲|稻香|兰亭序|珊瑚海|告白气球|七里香|孤勇者|起风了|富士山下|十年|红豆|后来|演员|消愁|成都|光年之外|泡沫|小幸运|那些年|体面|说散就散|海绵宝宝|可能|唯一|奢香夫人|最炫民族风|月亮之上|偏偏喜欢你|千千阙歌|甜蜜蜜|月亮代表我的心|我只在乎你|但愿人长久|错过的烟火|倒带|说爱你|布拉格广场|一直很安静|想见你|奇妙能力歌|小半|梦醒时分|爱情转移|浮夸|好久不见/i;

const CJK_RE = /[\u4e00-\u9fff]/;

const bucketMap = new Map([
    ["featured-performances", []],
    ["chinese-pop", []],
    ["game-music", []],
    ["anime-film", []],
    ["classical", []],
    ["western-music", []],
]);

// 每首曲目只归入一个流派，按优先级取最具体的一类；精选演出作为额外合辑可跨类。
const GENRE_PRIORITY = ["game-music", "anime-film", "chinese-pop", "western-music", "classical"];
const GENRE_TESTS = [
    ["game-music", GAME_RE],
    ["anime-film", ANIME_FILM_RE],
    ["chinese-pop", CHINESE_POP_RE],
    ["western-music", WESTERN_ARTIST_RE],
    ["classical", CLASSICAL_RE],
];

for (const song of songs) {
    const id = song.id;
    const name = String(song.name ?? "");

    if (performanceMap[id]) {
        bucketMap.get("featured-performances").push(id);
    }

    const matched = GENRE_TESTS.filter(([, re]) => re.test(name)).map(([key]) => key);
    if (matched.length > 0) {
        const genre = GENRE_PRIORITY.find((key) => matched.includes(key)) ?? matched[0];
        bucketMap.get(genre).push(id);
    } else {
        // 无任何匹配时按曲名语言兜底
        bucketMap.get(CJK_RE.test(name) ? "chinese-pop" : "western-music").push(id);
    }
}

const collections = [
    {
        id: "featured-performances",
        name: "精选演出",
        description: "包含编排演出与推荐特效的精选曲目",
        songIds: bucketMap.get("featured-performances"),
    },
    {
        id: "chinese-pop",
        name: "华语流行",
        description: "华语经典与当代流行钢琴曲目",
        songIds: bucketMap.get("chinese-pop"),
    },
    {
        id: "game-music",
        name: "游戏音乐",
        description: "原神、崩坏、Minecraft、东方与各大游戏原声",
        songIds: bucketMap.get("game-music"),
    },
    {
        id: "anime-film",
        name: "影视与动漫",
        description: "吉卜力、新海诚、经典动画与影视配乐",
        songIds: bucketMap.get("anime-film"),
    },
    {
        id: "classical",
        name: "古典钢琴",
        description: "古典大师名曲、浪漫派与现代钢琴独奏",
        songIds: bucketMap.get("classical"),
    },
    {
        id: "western-music",
        name: "欧美音乐",
        description: "欧美流行、电音与海外经典曲目",
        songIds: bucketMap.get("western-music"),
    },
];

const catalog = {
    version: 1,
    generatedAt: new Date().toISOString(),
    totalSongs: songs.length,
    collections,
    performances: performanceMap,
};

const outPath = path.join(libraryDir, "catalog.json");
fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2), "utf8");

console.log(`✓ Generated ${outPath} (${songs.length} songs):`);
for (const col of collections) {
    console.log(`  - ${col.id} (${col.name}): ${col.songIds.length} songs`);
}
