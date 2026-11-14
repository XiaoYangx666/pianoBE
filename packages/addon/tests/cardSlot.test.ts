import { describe, expect, mock, test } from "bun:test";

mock.module("@minecraft/server", () => ({
    system: {
        get currentTick() { return 0; },
        runTimeout: (callback: () => void) => { callback(); return 0; },
        runInterval: () => 0,
        clearRun: () => {},
        afterEvents: { scriptEventReceive: { subscribe: () => () => {} } },
        sendScriptEvent: () => {},
    },
    world: {
        afterEvents: { worldLoad: { subscribe: () => () => {} } },
        getPlayers: () => [],
    },
    Block: class {},
    MolangVariableMap: class {
        setVector3() {}
        setFloat() {}
    },
    TextPrimitive: class {
    },
    BlockPermutation: {
        resolve: (typeId: string, states: Record<string, string>) => ({
            type: { id: typeId },
            getState: (key: string) => states[key],
        }),
    },
    ItemStack: class { constructor(public typeId: string) {} },
    Player: class {},
    PlayerPermissionLevel: { Visitor: 0, Member: 1, Operator: 2, Custom: 3 },
    EntityComponentTypes: { Inventory: "minecraft:inventory", Equippable: "minecraft:equippable" },
    EquipmentSlot: { Mainhand: "Mainhand" },
}));

const { CardSlot } = await import("../src/platform/storage/cardSlot");
const { CardAccess, MUSIC_CARD_ID, cardName, containerItemSlot } = await import("../src/platform/storage/cardItem");
const { FakeEntity, FakeItemStack } = await import("./support/fakeItems");
const { encodePbe2 } = await import("@piano/core");

function card(name = "我的卡"): InstanceType<typeof FakeItemStack> {
    const item = new FakeItemStack(MUSIC_CARD_ID);
    item.nameTag = name;
    return item;
}

function music(id = "card1", notes = 8, compress: boolean | "auto" = "auto"): Uint8Array {
    const values: number[] = [];
    for (let index = 0; index < notes; index++) values.push(60 + (index % 12), index * 40, 20, 90);
    return encodePbe2({
        id,
        name: `卡上歌曲 ${id}`,
        duration: Math.max(1, notes * 40),
        tracks: [{ instrument: { family: "", number: 0, name: "" }, notes: values }],
    }, { compress });
}

function makePlayer() {
    const slots: Array<{ item?: FakeItemStack }> = Array.from({ length: 36 }, () => ({}));
    const inventory = {
        isValid: true,
        get size() { return slots.length; },
        get emptySlotsCount() { return slots.filter(slot => !slot.item).length; },
        getItem: (index: number) => slots[index]?.item,
        setItem: (index: number, item?: FakeItemStack) => { slots[index].item = item; },
        addItem: (item: FakeItemStack) => {
            const slot = slots.find(entry => !entry.item);
            if (!slot) return item;
            slot.item = item;
            return undefined;
        },
    };
    const spawned: FakeItemStack[] = [];
    return {
        player: {
            isValid: true,
            location: { x: 0, y: 64, z: 0 },
            dimension: { spawnItem: (item: FakeItemStack) => { spawned.push(item); } },
            getComponent: (id: string) => id === "minecraft:inventory" ? { container: inventory } : undefined,
        } as any,
        inventory,
        spawned,
    };
}

describe("钢琴卡槽（真实 ItemStack 容器）", () => {
    test("插入后槽位里是真的卡，重复插入被拒绝且不覆盖", () => {
        const entity = new FakeEntity();
        const slot = new CardSlot(entity as any);
        const first = card("第一张");
        const second = card("第二张");

        expect(slot.insert(first).ok).toBe(true);
        expect(slot.occupied).toBe(true);
        expect(slot.read()?.nameTag).toBe("第一张");

        const result = slot.insert(second);
        expect(result.ok).toBe(false);
        expect(result.message).toContain("已经有一张");
        expect(slot.read()?.nameTag).toBe("第一张");
    });

    test("取卡返回同一份物品（含卡片数据），槽位清空", () => {
        const entity = new FakeEntity();
        const slot = new CardSlot(entity as any);
        const item = card();
        slot.insert(item);

        const taken = slot.take();
        expect(taken).toBe(item);
        expect(slot.occupied).toBe(false);
    });

    test("背包满时弹出掉在玩家脚下，不吞卡", () => {
        const { player, inventory, spawned } = makePlayer();
        // 填满背包
        for (let index = 0; index < 36; index++) inventory.setItem(index, card("填充"));
        const entity = new FakeEntity();
        const slot = new CardSlot(entity as any);
        const item = card("贵重卡");
        slot.insert(item);

        const result = slot.ejectTo(player);
        expect(result?.delivered).toBe(false);
        expect(spawned).toHaveLength(1);
        expect(spawned[0]).toBe(item);
        expect(slot.occupied).toBe(false);
    });

    test("插卡数据在“区块卸载/重新读取”后仍完整", () => {
        const entity = new FakeEntity();
        const slot = new CardSlot(entity as any);
        const item = card();
        slot.insert(item);

        const access = CardAccess.open(containerItemSlot(entity.inventory as any, 0))!;
        access.storage().save(music());

        // 模拟重新加载：从容器里重新取一次 ItemStack
        const reloaded = entity.inventory!.getItem(0)!;
        const reopened = CardAccess.open(containerItemSlot(entity.inventory as any, 0))!;
        expect(cardName(reloaded)).toBe(reloaded.nameTag ?? "音乐存储卡");
        expect(reopened.storage().list()).toHaveLength(1);
    });

    test("卡片被替换后，旧的写句柄拒绝写入", () => {
        const entity = new FakeEntity();
        const slot = new CardSlot(entity as any);
        slot.insert(card("旧卡"));
        const stale = slot.access()!;

        // 玩家把卡换成另一张（不同 UID）
        slot.take();
        slot.insert(card("新卡"));
        slot.access()!.mutate((item) => item.setDynamicProperty("pb.cardmeta.probe", 1));

        expect(() => stale.storage().save(music("x"))).toThrow(/替换|移走/);
        // 新卡没有被写入旧操作的数据
        expect(slot.access()!.storage().list()).toHaveLength(0);
    });

    test("容量按实际字节拒绝，并显示卡片用量/Lore", () => {
        const entity = new FakeEntity();
        const slot = new CardSlot(entity as any);
        slot.insert(card("小卡"));
        const access = slot.access()!;
        const storage = access.storage(8192);
        const bytes = music("fit");
        const entry = storage.save(bytes);
        expect(storage.list()).toHaveLength(1);

        access.refreshLore();
        const item = slot.read()!;
        expect(item.lore[0]).toContain("已存 1 首");

        const tight = access.storage(8192);
        expect(() => tight.save(music("too-big", 6000, false))).toThrow(/容量不足/);
        expect(entry.bytes).toBe(bytes.length);
    });

    test("非卡片物品不能插入卡槽", () => {
        const entity = new FakeEntity();
        const slot = new CardSlot(entity as any);
        const result = slot.insert(new FakeItemStack("minecraft:stone"));
        expect(result.ok).toBe(false);
        expect(slot.occupied).toBe(false);
    });
});
