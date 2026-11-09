import { describe, expect, test } from "bun:test";
import { flatTextYaw } from "../src/domain/piano/textRotation";

// A pitch-90 text primitive lies face-up, so its yaw controls the in-plane
// heading rather than the facing normal.
const top = (yaw: number) => ({
    x: Math.sin(yaw * Math.PI / 180),
    z: Math.cos(yaw * Math.PI / 180),
});

describe("flat display text heading", () => {
    test.each([
        { facing: "north", yaw: 180, away: { x: 0, z: 1 } },
        { facing: "south", yaw: 0, away: { x: 0, z: -1 } },
        { facing: "east", yaw: -90, away: { x: -1, z: 0 } },
        { facing: "west", yaw: 90, away: { x: 1, z: 0 } },
    ])("$facing keeps the top of the text away from the player", ({ yaw, away }) => {
        const heading = top(flatTextYaw(yaw));
        expect(heading.x).toBeCloseTo(away.x);
        expect(heading.z).toBeCloseTo(away.z);
    });
});
