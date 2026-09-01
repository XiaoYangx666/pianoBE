import { Player } from "@minecraft/server";

/**
 * DDUI 管理器：**强制复用**，且缓存永不删除。
 *
 * 原因：Minecraft 基岩版 DDUI 表单一经创建便**无法释放**（原生层不 GC）。
 * 因此：
 * 1. 每个玩家永远只允许创建一次表单 —— 复用是唯一有效的内存缓解
 *    （泄漏复测确认：关闭复用、每次新建时内存疯狂增长）；
 * 2. 实例按键（player.id）**永久缓存**，绝不能因玩家离开而删除：
 *    删除后重进会再次新建一个永远释放不了的表单，反而加重泄漏。
 */
export abstract class DDUIManager<T> {
    protected instances = new Map<string, T>();

    /** 子类必须实现：如何创建实例 */
    protected abstract create(player: Player): T;

    get(player: Player): T {
        let inst = this.instances.get(player.id);

        if (!inst || !player.isValid) {
            inst = this.create(player);
            this.instances.set(player.id, inst);
        }

        return inst;
    }

    clear() {
        this.instances.clear();
    }
}