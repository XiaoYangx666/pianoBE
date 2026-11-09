import { describe, expect, test } from "bun:test";
import { RuntimeScope } from "@begame/tabletop";
import { PianoScope } from "../src/runtime/scope";

function rootScope() {
    return new RuntimeScope({
        now: () => 0,
        schedule: () => ({ cancel() {} }),
    });
}

describe("PianoScope ownership", () => {
    test("runs every cleanup even when one fails", () => {
        const reports: string[] = [];
        const scope = new PianoScope(rootScope(), "test", boundary => reports.push(boundary));
        const calls: string[] = [];

        scope.own("a", () => calls.push("a"));
        scope.own("boom", () => {
            calls.push("boom");
            throw new Error("boom");
        });
        scope.own("c", () => calls.push("c"));

        expect(() => scope.dispose()).not.toThrow();
        expect(calls).toEqual(["a", "boom", "c"]);
        expect(reports).toEqual(["test.boom"]);
        expect(scope.disposed).toBe(true);
        expect(scope.pending).toBe(0);
    });

    test("child scopes cascade and dispose is idempotent", () => {
        const scope = new PianoScope(rootScope(), "test", () => {});
        const calls: string[] = [];
        const child = scope.child("visual");
        child.own("text", () => calls.push("text"));

        scope.dispose();
        scope.dispose();

        expect(child.disposed).toBe(true);
        expect(calls).toEqual(["text"]);
    });
});
