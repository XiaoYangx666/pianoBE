import { describe, expect, test } from "bun:test";
import { DDUIManager } from "../src/app/ui/ddui";

interface Instance {
    playerId: string;
    disposed: boolean;
}

class TestManager extends DDUIManager<Instance> {
    protected create(player: { id: string }): Instance {
        return { playerId: player.id, disposed: false };
    }

    protected discard(value: Instance): void {
        value.disposed = true;
    }
}

function player(id: string, valid = true) {
    return { id, isValid: valid } as never;
}

describe("DDUIManager invalidation", () => {
    test("reuses one instance while the player session is valid", () => {
        const manager = new TestManager();
        const p = player("p1");
        expect(manager.get(p)).toBe(manager.get(p));
    });

    test("invalidate disposes and drops the cached instance", () => {
        const manager = new TestManager();
        const p = player("p1");
        const first = manager.get(p);
        manager.invalidate("p1");
        expect(first.disposed).toBe(true);
        expect(manager.get(p)).not.toBe(first);
    });

    test("a stale owner is discarded before a new session is created", () => {
        const manager = new TestManager();
        const p = player("p1");
        const first = manager.get(p);
        p.isValid = false;
        const next = manager.get(p);
        expect(first.disposed).toBe(true);
        expect(next).not.toBe(first);
    });

    test("clear disposes every cached instance", () => {
        const manager = new TestManager();
        const a = manager.get(player("a"));
        const b = manager.get(player("b"));
        manager.clear();
        expect(a.disposed).toBe(true);
        expect(b.disposed).toBe(true);
    });
});
