import { hostTickAt, timelineTickAt } from "../../src";

/** Test-only conversion from a whole timeline tick to the branded performance domain. */
export const tt = (tick: number) => timelineTickAt(tick / 20);

/** Test-only conversion from a whole host tick to the branded resource domain. */
export const ht = (tick: number) => hostTickAt(tick);
