import { Player } from "@minecraft/server";

interface CachedInstance<T> {
    value: T;
    /**
     * 创建实例时绑定的玩家对象。
     * 玩家退出重进后旧 Player 对象会失效（死亡重生通常不会），DDUI 表单的
     * 客户端写权限会随旧会话结束，继续复用会刷
     * "Client is attempting to set DDUI property ... but it does not have access."
     */
    owner: Player;
}

/**
 * DDUI 管理器：同一会话内强制复用表单。
 *
 * 原因：Minecraft 基岩版 DDUI 表单一经创建便**无法释放**（原生层不 GC），
 * 因此同一玩家在同一会话内只创建一次表单，避免每次打开都新建导致内存持续增长。
 *
 * 但表单绑定的是创建时的 Player 实例：玩家退出重进后旧 Player 会失效，
 * 旧表单的客户端访问权限也随之失效。此时必须重建表单，否则客户端点击按钮、
 * 切换开关都会被拒绝（"does not have access"）。重建只在会话失效时发生，
 * 正常开关 UI 仍然复用同一份表单。
 */
export abstract class DDUIManager<T> {
    protected instances = new Map<string, CachedInstance<T>>();

    /** 子类必须实现：如何创建实例 */
    protected abstract create(player: Player): T;

    get(player: Player): T {
        const cached = this.instances.get(player.id);

        if (cached && !this.isStale(cached.owner)) {
            return cached.value;
        }

        // 旧会话的表单已无法再被客户端写入，先让子类清理订阅等资源
        if (cached) {
            this.discard(cached.value);
            console.info(
                `[ddui] ${player.name} 的表单已随旧会话失效，重建表单`
            );
        }

        const value = this.create(player);
        this.instances.set(player.id, { value, owner: player });
        return value;
    }

    /** 缓存中的 Player 是否已失效（退出重进等会话结束场景） */
    private isStale(owner: Player): boolean {
        try {
            return !owner.isValid;
        } catch {
            return true;
        }
    }

    /**
     * 实例被新会话替换前调用。
     * 子类可重写以取消对共享对象（如 MidiPlayer）的订阅、关闭旧表单。
     */
    protected discard(_value: T): void {}

    /** 玩家离开时立即释放实例（旧会话表单不可再用，订阅也应停止） */
    invalidate(playerId: string) {
        const cached = this.instances.get(playerId);
        if (!cached) return;

        this.discard(cached.value);
        this.instances.delete(playerId);
    }

    clear() {
        for (const cached of this.instances.values()) {
            this.discard(cached.value);
        }
        this.instances.clear();
    }
}
