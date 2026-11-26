import { blockPlacerComponent } from "@app/components/blockPlacer";
import { PianoBlockComponent, registerPianoBlockEvents } from "@app/components/pianoBlock";
import { MusicCardComponent } from "@app/components/musicCard";
import { P88BenchRecoveryComponent, PianoBenchComponent, registerPianoBenchEvents } from "@app/components/pianoBench";
import { createBlockResourceEvents, createNativeDropSuppression } from "@begame/tabletop/minecraft";
import { eventHost } from "@platform/host";
import { invalidateMidiImport } from "@app/ui/midi/importUI";
import { pianoWorld } from "@app/PianoWorld";
import { openPbeSettings } from "@app/ui/adminSettingsUI";
import { openAdminLibrary } from "@app/ui/adminLibraryUI";
import { registerVfx } from "@app/vfx";
import { clearPlayerPerformance } from "@app/playerPerformance";
import { midiManager } from "@app/midi";
import { loadPbeSettings } from "@platform/storage/pbeSettingsStore";
import { worldLibrary } from "@platform/storage/worldLibrary";
import { setDiagnosticSink } from "@piano/core";
import { createLogger, routeDiagnostic, setLogLevel } from "@runtime/log";
import { system, world } from "@minecraft/server";
import { Command, initSAPIPro, pcommand } from "sapi-pro";

// core / vfx 的诊断统一走 addon logger，保证控制台前缀和级别一致。
setDiagnosticSink(routeDiagnostic);
const log = createLogger("app");

//注册模组组件
system.beforeEvents.startup.subscribe((e) => {
    e.itemComponentRegistry.registerCustomComponent(
        "pbe:placer",
        blockPlacerComponent
    );
    e.itemComponentRegistry.registerCustomComponent(
        "pbe:p88_bench_placer",
        blockPlacerComponent
    );
    e.blockComponentRegistry.registerCustomComponent(
        "pbe:piano_block",
        PianoBlockComponent
    );
    e.blockComponentRegistry.registerCustomComponent(
        "pbe:piano_bench_seating",
        PianoBenchComponent
    );
    e.blockComponentRegistry.registerCustomComponent(
        "pbe:p88_bench_recovery",
        P88BenchRecoveryComponent
    );
    e.itemComponentRegistry.registerCustomComponent(
        "pbe:music_card",
        MusicCardComponent
    );
});

const blockEvents = createBlockResourceEvents(eventHost, createNativeDropSuppression(eventHost));
registerPianoBenchEvents(blockEvents);
registerPianoBlockEvents(blockEvents);
blockEvents.start();
registerVfx();

// 世界动态属性不能在模块求值期访问（early execution），延后到首个游戏刻加载配置。
system.run(() => {
    try {
        loadPbeSettings();
    } catch (error) {
        log.warn("读取管理员设置失败", error);
    }
    // 世界级全局曲库：启动时扫描一次元数据，之后搜索/分页只查内存索引。
    try {
        worldLibrary.reload();
        midiManager.addPublicSource(worldLibrary.publicSource);
    } catch (error) {
        log.warn("加载世界全局曲库失败", error);
    }
});

// 玩家离开时清空 MIDI 导入进度与演奏动画状态；其它表单实例会随各自 show() 结束自动释放。
world.afterEvents.playerLeave.subscribe((e) => {
    invalidateMidiImport(e.playerId);
    clearPlayerPerformance(e.playerId);
});

// 启动标记：确认行为包脚本已加载及其构建目标（模板包=client / 服务器专用包=server）
log.info("主脚本已加载", { target: __PIANO_TARGET__ });

// 现场排查时临时打开细节日志：/scriptevent pbe:log debug
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "pbe:log") return;
    const level = event.message.trim().toLowerCase();
    if (level !== "debug" && level !== "info" && level !== "warn" && level !== "error") return;
    setLogLevel(level);
    log.info("日志级别已切换", { level });
    const player = event.sourceEntity as { sendMessage?: (message: string) => void } | undefined;
    player?.sendMessage?.(`§a[PianoBE] 日志级别：${level}`);
});

initSAPIPro({
    name: "**NAME**",
    version: "**VERSION**",
    description: "**DESCRIPTION**",
    author: "XiaoYangx666",
    nameSpace: "pbe",
    uuid: "ee4ee253-b1c5-4447-9e52-356f5e6ed11b",
});

// stable 版 SAPI 只能注册原生命令；registerCommand 在 stable 下不可调用。
pcommand.registerNative(
    new Command("midilist", "查看 MIDI 缓存与钢琴运行时诊断", true, (player) => {
        const stats = midiManager.cacheStats();
        player.sendMessage(
            `[SongCache] ${stats.songs} 首 / ${(stats.bytes / 1024).toFixed(0)} KB ` +
                `(预算 ${(stats.maxBytes / 1024).toFixed(0)} KB, 活跃 ${stats.activeSongs}, ` +
                `加载中 ${stats.loading}, 淘汰 ${stats.evictions}, 命中 ${stats.hits}/${stats.hits + stats.misses})`
        );
        player.sendMessage(`[日志] level=${log.level}`);
        player.sendMessage(pianoWorld.debugDump());
    })
);

// 管理员设置：/pbe:pbe_setting（原生命令 + 管理员权限）
pcommand.registerNative(
    new Command("pbe_setting", "PianoBE 管理员设置", true, (player) => {
        openPbeSettings(player);
    })
);

// 管理员全局曲库：/pbe:pbe_library（无需存储卡）
pcommand.registerNative(
    new Command("pbe_library", "PianoBE 全局曲库管理", true, (player) => {
        openAdminLibrary(player);
    })
);

// 远程曲库与服务器版可选功能（BDS 专用：server-admin 读 secrets.json 配置后端
// URL/token，经 server-net 拉取）。client 构建时此分支被 compile.define 注入常量
// 折叠 + 死代码消除整体裁剪（产物不含 serverAdmin/serverNet/在线转录代码）。
if (__PIANO_TARGET__ === "server") {
    log.debug("server 构建：20 tick 后尝试初始化远程曲库");
    system.runTimeout(async () => {
        try {
            const { initServerAdmin } = await import("./serverAdmin.js");
            const backend = await initServerAdmin();
            if (!backend) return;
            const { initServerFeatures } = await import("./server/features.js");
            initServerFeatures(backend);
        } catch (e) {
            log.warn("远程曲库初始化失败，使用内嵌曲库", e);
        }
    }, 20);
}
