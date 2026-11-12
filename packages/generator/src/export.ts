import type { AddonTemplate } from "@bepack/addon";
import { metasToAddonIndex, pbe2ToAddonModule } from "@piano/core";
import type { SongEntry } from "./types";
import type { TemplateInfo } from "./template";
import type { LoadedTimbrePack, TimbreIndexEntry } from "./timbres";
import { TIMBRES_SCRIPT_PATH } from "./timbres";
import {
    SCORE_PACK_SCRIPT_PATH,
    scoreStandPath,
    serializeScorePackModule,
    type ScoreEntry,
} from "./scores";

export interface ExportOptions {
    name: string;
    desc: string;
    randomUuid: boolean;
    /** 音色选择；不传则保持模板原样（兼容旧调用） */
    timbres?: TimbreExportSelection;
    /** 曲谱列表；不传或为空则保持模板原样（只更新资源包 UUID） */
    scores?: ScoreEntry[];
}

export interface TimbreExportSelection {
    /** 所有已知音色（用于从旧模板中剥离未选中的可选音色） */
    all: TimbreIndexEntry[];
    /** 已按需加载、需要写入导出包的可选音色 */
    selected: LoadedTimbrePack[];
    /** 实际启用的音色 id，会写进 scripts/packages/addon/src/domain/piano/timbres.js */
    enabledIds: string[];
}

/**
 * 生成最终 .mcaddon（zip Blob）。
 * - 曲目模块：模板已有曲目原样保留（字节保真），新曲目由 core 生成；
 *   index.js 统一用 core 的 metasToAddonIndex 重新生成（格式与历史一致）
 * - manifest：应用名称/描述，可选随机化 UUID（含 bp/rp 交叉依赖与模块 UUID）
 */
export async function generateAddonZip(
    info: TemplateInfo,
    songs: SongEntry[],
    opts: ExportOptions
): Promise<Blob> {
    const { addon, bpPath, rpPath } = info;

    const { identity } = addon.updateIdentity(
        {
            name: opts.name,
            description: opts.desc,
            resourceName: `${opts.name} (RP)`,
            randomizeUuids: opts.randomUuid,
        },
        { indent: 4 }
    );
    const scorePackModule = `${bpPath}${SCORE_PACK_SCRIPT_PATH}`;
    const resourcePackId = identity.resourcePack?.headerUuid;
    if (opts.scores && opts.scores.length > 0 && resourcePackId) {
        applyScores(addon, bpPath, rpPath, opts.scores, resourcePackId);
    } else if (resourcePackId && addon.has(scorePackModule)) {
        // 未传曲谱时只替换 UUID，保留模板原有的 PIANO_SCORES 等数据。
        const existing = addon.readTextSync(scorePackModule) ?? "";
        const idPattern = /(SCORE_RESOURCE_PACK_ID\s*=\s*)([^;]+)/;
        const updated = idPattern.test(existing)
            ? existing.replace(idPattern, `$1${JSON.stringify(resourcePackId)}`)
            : `export const SCORE_RESOURCE_PACK_ID = ${JSON.stringify(resourcePackId)};\n`;
        addon.writeText(scorePackModule, updated);
    }

    // ---- 重写 scripts/midis ----
    const midisDir = `${bpPath}scripts/midis/`.replace(/\/+/g, "/");
    addon.removeTree(midisDir);

    for (const entry of songs) {
        const content = entry.data
            ? pbe2ToAddonModule(entry.data)
            : (entry.moduleText ?? "");
        addon.writeText(`${midisDir}${entry.id}.js`, content);
    }
    addon.writeText(
        `${midisDir}index.js`,
        metasToAddonIndex(songs.map((s) => ({ id: s.id, name: s.name, duration: s.duration })))
    );

    if (opts.timbres) applyTimbres(addon, bpPath, rpPath, opts.timbres);

    return addon.toBlob();
}

/**
 * 把模板裁剪成“只包含选中音色”的状态：
 * - 先移除所有已知可选音色目录和 sound_definitions 条目（兼容旧的完整模板）
 * - 再合并已按需加载的音色包
 * - 最后覆写 scripts/packages/addon/src/domain/piano/timbres.js，让游戏内设置只显示实际存在的音色
 */
function applyTimbres(
    addon: AddonTemplate,
    bpPath: string,
    rpPath: string,
    selection: TimbreExportSelection
) {
    const soundRoot = `${rpPath}sounds/`;
    const definitionsPath = `${soundRoot}sound_definitions.json`;
    const definitionsText = addon.readTextSync(definitionsPath);
    const definitions = definitionsText
        ? JSON.parse(definitionsText)
        : { format_version: "1.26.0", sound_definitions: {} };
    definitions.sound_definitions ??= {};

    const optionalDirs = new Set<string>();
    for (const timbre of selection.all) {
        if (timbre.id === "piano") continue;
        for (const dir of Object.values(timbre.dirs)) {
            optionalDirs.add(dir);
            addon.removeTree(`${soundRoot}${dir}/`);
        }
    }
    for (const key of Object.keys(definitions.sound_definitions)) {
        if (optionalDirs.has(key.split(".")[0])) delete definitions.sound_definitions[key];
    }

    for (const pack of selection.selected) {
        for (const [path, data] of pack.files) {
            if (path.startsWith("sounds/")) addon.write(`${rpPath}${path}`, data);
        }
        Object.assign(definitions.sound_definitions, pack.soundDefinitions);
    }

    addon.writeText(definitionsPath, `${JSON.stringify(definitions, null, 4)}\n`);
    const enabled = [...new Set(["piano", ...selection.enabledIds])];
    const timbresModule = `${bpPath}${TIMBRES_SCRIPT_PATH}`;
    if (!addon.has(timbresModule)) {
        console.warn(`[generator] 模板缺少 ${timbresModule}，音色勾选可能无法在游戏内生效`);
    }
    addon.writeText(
        timbresModule,
        `export const ENABLED_PIANO_TIMBRES = ${JSON.stringify(enabled)};\n`
    );
}

/**
 * 重写曲谱数据与纹理：
 * - 先读出模板曲谱的原始字节（removeTree 后原文件就不存在了）
 * - 清空两类曲谱纹理目录，再按最终顺序写入
 * - 更新 scorePack.js、RP 实体 textures、render controller 纹理数组
 *   与 BP 实体 score_variant 范围
 */
function applyScores(
    addon: AddonTemplate,
    bpPath: string,
    rpPath: string,
    scores: readonly ScoreEntry[],
    resourcePackId: string
) {
    const uiRoot = `${rpPath}textures/ui/piano_score/`;
    const standRoot = `${rpPath}textures/entity/piano_score/`;

    const planned = scores.map((score) => {
        const files = new Map<string, Uint8Array>();
        for (const page of score.pages) {
            // loadTemplate 通过 readAddon(Blob) 完整载入，模板纹理可用 readSync 直接取原字节
            const bytes = score.assets?.get(page) ?? addon.readSync(`${rpPath}${page}`)?.bytes;
            if (bytes) files.set(page, bytes);
            else console.warn(`[generator] 曲谱 ${score.id} 缺少页面纹理：${page}`);
        }
        const stand = scoreStandPath(score.id);
        const standBytes = score.assets?.get(stand) ?? addon.readSync(`${rpPath}${stand}`)?.bytes;
        if (standBytes) files.set(stand, standBytes);
        else console.warn(`[generator] 曲谱 ${score.id} 缺少谱架纹理：${stand}`);
        return files;
    });

    addon.removeTree(uiRoot);
    addon.removeTree(standRoot);
    for (const files of planned) {
        for (const [path, bytes] of files) addon.write(`${rpPath}${path}`, bytes);
    }

    addon.writeText(`${bpPath}${SCORE_PACK_SCRIPT_PATH}`, serializeScorePackModule(scores, resourcePackId));

    const firstId = scores[0].id;
    updateRpEntityTextures(addon, rpPath, firstId, scores.map((score) => score.id));
    updateRpRenderController(addon, rpPath, scores.length);
    updateBpScoreVariant(addon, bpPath, scores.length);
}

function updateRpEntityTextures(
    addon: AddonTemplate,
    rpPath: string,
    firstId: string,
    ids: readonly string[]
) {
    const path = `${rpPath}entity/grand_score.entity.json`;
    const text = addon.readTextSync(path);
    if (!text) {
        console.warn(`[generator] 模板缺少 ${path}，无法同步谱架纹理列表`);
        return;
    }
    const json = JSON.parse(text) as RpEntityJson;
    const description = json["minecraft:client_entity"]?.description;
    if (!description) {
        console.warn(`[generator] ${path} 缺少 client_entity.description，无法同步谱架纹理列表`);
        return;
    }
    // Bedrock 的纹理数组由 render controller 引用；这里只声明 Texture.score_<n>。
    const textures: Record<string, string> = {
        default: `textures/entity/piano_score/${firstId}`,
    };
    ids.forEach((id, index) => {
        textures[`score_${index}`] = `textures/entity/piano_score/${id}`;
    });
    description.textures = textures;
    addon.writeText(path, `${JSON.stringify(json, null, 4)}\n`);
}

function updateRpRenderController(addon: AddonTemplate, rpPath: string, count: number) {
    const path = `${rpPath}render_controllers/grand_score.render_controllers.json`;
    const text = addon.readTextSync(path);
    if (!text) {
        console.warn(`[generator] 模板缺少 ${path}，无法同步谱架纹理数组`);
        return;
    }
    const json = JSON.parse(text) as RpRenderControllerJson;
    const controller = json.render_controllers?.["controller.render.xypiano.grand_score"];
    if (!controller) {
        console.warn(`[generator] ${path} 缺少谱架 render controller，无法同步纹理数组`);
        return;
    }
    controller.arrays ??= {};
    controller.arrays.textures ??= {};
    controller.arrays.textures["Array.scores"] = Array.from(
        { length: count },
        (_, index) => `Texture.score_${index}`
    );
    controller.textures = ["Array.scores[q.property('xypiano:score_variant')]"];
    addon.writeText(path, `${JSON.stringify(json, null, 4)}\n`);
}

function updateBpScoreVariant(addon: AddonTemplate, bpPath: string, count: number) {
    const path = `${bpPath}entities/grand_score.json`;
    const text = addon.readTextSync(path);
    if (!text) {
        console.warn(`[generator] 模板缺少 ${path}，无法同步曲谱变体范围`);
        return;
    }
    const json = JSON.parse(text) as BpEntityJson;
    const description = json["minecraft:entity"]?.description;
    if (!description) {
        console.warn(`[generator] ${path} 缺少 entity.description，无法同步曲谱变体范围`);
        return;
    }
    description.properties ??= {};
    description.properties["xypiano:score_variant"] = {
        type: "int",
        // Bedrock rejects range min == max; keep at least [0, 1].
        range: [0, Math.max(1, count - 1)],
        default: 0,
        client_sync: true,
    };
    addon.writeText(path, `${JSON.stringify(json, null, 4)}\n`);
}

interface RpEntityJson {
    "minecraft:client_entity"?: {
        description?: {
            textures?: Record<string, unknown>;
            [key: string]: unknown;
        };
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

interface RpRenderControllerJson {
    render_controllers?: Record<
        string,
        {
            arrays?: {
                textures?: Record<string, unknown>;
                [key: string]: unknown;
            };
            textures?: unknown;
            [key: string]: unknown;
        }
    >;
    [key: string]: unknown;
}

interface BpEntityJson {
    "minecraft:entity"?: {
        description?: {
            properties?: Record<string, unknown>;
            [key: string]: unknown;
        };
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
