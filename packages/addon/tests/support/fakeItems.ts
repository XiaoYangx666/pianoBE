/** 测试用的 ItemStack 替身：保留动态属性、克隆与 Lore 行为。 */

type PropertyValue = string | number | boolean | { x: number; y: number; z: number };

export class FakeItemStack {
    amount: number;
    nameTag?: string;
    lore: string[] = [];
    private readonly properties = new Map<string, PropertyValue>();

    constructor(public typeId: string, amount = 1) {
        this.amount = amount;
    }

    clone(): FakeItemStack {
        const copy = new FakeItemStack(this.typeId, this.amount);
        copy.nameTag = this.nameTag;
        copy.lore = [...this.lore];
        for (const [key, value] of this.properties) copy.properties.set(key, value);
        return copy;
    }

    setLore(lines: string[]) {
        this.lore = [...lines];
    }

    getLore() {
        return this.lore;
    }

    getDynamicProperty(key: string) {
        return this.properties.get(key);
    }

    setDynamicProperty(key: string, value?: PropertyValue) {
        if (value === undefined) this.properties.delete(key);
        else this.properties.set(key, value);
    }

    getDynamicPropertyIds() {
        return [...this.properties.keys()];
    }

    getDynamicPropertyTotalByteCount() {
        let total = 0;
        for (const [key, value] of this.properties) {
            total += key.length * 2 + JSON.stringify(value).length * 2;
        }
        return total;
    }

    propertiesSnapshot() {
        return new Map(this.properties);
    }
}

export interface FakeContainerSlot {
    item?: FakeItemStack;
}

export class FakeContainer {
    isValid = true;
    constructor(readonly slots: FakeContainerSlot[]) {}

    get size() {
        return this.slots.length;
    }

    get emptySlotsCount() {
        return this.slots.filter(slot => !slot.item).length;
    }

    getItem(index: number) {
        return this.slots[index]?.item;
    }

    setItem(index: number, item?: FakeItemStack) {
        if (!this.slots[index]) throw new Error("slot out of range");
        this.slots[index].item = item;
    }

    addItem(item: FakeItemStack) {
        const slot = this.slots.find(entry => !entry.item);
        if (!slot) return item;
        slot.item = item;
        return undefined;
    }
}

export class FakeEntity {
    isValid = true;
    readonly dynamicProperties = new Map<string, PropertyValue>();
    readonly properties = new Map<string, PropertyValue>();
    inventory?: FakeContainer;

    constructor(public typeId = "xypiano:piano_display", inventorySize = 1) {
        if (inventorySize > 0) this.inventory = new FakeContainer(Array.from({ length: inventorySize }, () => ({})));
    }

    getComponent(id: string) {
        if (id === "minecraft:inventory" && this.inventory) return { container: this.inventory };
        return undefined;
    }

    getDynamicProperty(key: string) {
        return this.dynamicProperties.get(key);
    }

    setDynamicProperty(key: string, value?: PropertyValue) {
        if (value === undefined) this.dynamicProperties.delete(key);
        else this.dynamicProperties.set(key, value);
    }

    getDynamicPropertyIds() {
        return [...this.dynamicProperties.keys()];
    }

    getDynamicPropertyTotalByteCount() {
        let total = 0;
        for (const [key, value] of this.dynamicProperties) total += key.length * 2 + JSON.stringify(value).length * 2;
        return total;
    }

    setProperty(key: string, value: PropertyValue) {
        this.properties.set(key, value);
    }

    getProperty(key: string) {
        return this.properties.get(key);
    }
}

export class MemoryKv {
    readonly data = new Map<string, string>();
    failOn: string | undefined;
    failAfterWrites = 0;
    private writes = 0;

    keys() {
        return [...this.data.keys()];
    }

    get(key: string) {
        return this.data.get(key);
    }

    set(key: string, value: string) {
        this.writes++;
        if (this.failOn === key) throw new Error("simulated write failure");
        if (this.failAfterWrites > 0 && this.writes > this.failAfterWrites) throw new Error("simulated write failure");
        this.data.set(key, value);
    }

    delete(key: string) {
        this.data.delete(key);
    }

    get writeCount() {
        return this.writes;
    }
}
