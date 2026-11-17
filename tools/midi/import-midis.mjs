/**
 * 批量导入 midis/files 到后端曲库：node tools/import-midis.mjs --base http://host:3000 --token xxx
 * 服务端负责 .mid → 曲目转换（幂等：同 id 覆盖），本地只做已存在跳过与并发上传。
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
function arg(name) {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
}

const base = (arg("--base") ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const token = arg("--token") ?? process.env.PIANO_TOKEN;
const dir = path.resolve(arg("--dir") ?? "./midis/files");
const concurrency = Number(arg("--concurrency") ?? 4);

if (!token) {
    console.error("缺少令牌：--token <token> 或环境变量 PIANO_TOKEN");
    process.exit(1);
}
if (!fs.existsSync(dir)) {
    console.error(`目录不存在: ${dir}`);
    process.exit(1);
}

const headers = (extra = {}) => ({
    Authorization: `Bearer ${token}`,
    ...extra,
});

// 1. 分页拉取全部已有曲目 id（跳过已存在的）
const existing = new Set();
let page = 1;
while (true) {
    const listRes = await fetch(
        `${base}/api/songs?pageSize=100&page=${page}`,
        { headers: headers() }
    );
    if (!listRes.ok) {
        console.error(`无法访问后端 ${base}/api/songs: ${listRes.status}`);
        process.exit(1);
    }
    const data = await listRes.json();
    for (const s of data.items) existing.add(s.id);
    if (page * 100 >= data.total) break;
    page++;
}
console.log(`后端现有曲目: ${existing.size} 首`);

// 2. 待导入列表
const files = fs
    .readdirSync(dir)
    .filter((f) => /\.midi?$/i.test(f))
    .sort();
console.log(`待检查: ${files.length} 个文件`);

// 3. 并发上传
let ok = 0;
let skipped = 0;
let failed = 0;
let queue = [...files];

async function worker() {
    while (queue.length > 0) {
        const file = queue.shift();
        const buffer = fs.readFileSync(path.join(dir, file));
        // 先本地算 id（crc32 与后端同算法）跳过已存在
        const { crc32Hex } = await import("@piano/core");
        const id = crc32Hex(new Uint8Array(buffer));
        if (existing.has(id)) {
            skipped++;
            console.log(`⏭  跳过(已存在) ${file} (${id})`);
            continue;
        }
        try {
            const res = await fetch(`${base}/api/songs`, {
                method: "POST",
                headers: headers({ "X-File-Name": encodeURIComponent(file) }),
                body: buffer,
            });
            if (res.ok) {
                ok++;
                existing.add(id);
                console.log(`✅ 导入 ${file} (${id})`);
            } else {
                failed++;
                console.error(`❌ 失败 ${file}: ${res.status} ${(await res.text()).slice(0, 120)}`);
            }
        } catch (e) {
            failed++;
            console.error(`❌ 网络错误 ${file}: ${e.message}`);
        }
    }
}

await Promise.all(Array.from({ length: concurrency }, worker));

console.log(`\n完成：导入 ${ok}，跳过 ${skipped}，失败 ${failed}`);
process.exit(failed > 0 ? 1 : 0);