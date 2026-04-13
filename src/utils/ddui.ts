import { Player } from "@minecraft/server";

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

    delete(player: Player) {
        this.instances.delete(player.id);
    }

    clear() {
        this.instances.clear();
    }
}
