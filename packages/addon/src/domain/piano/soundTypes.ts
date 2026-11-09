import type { PianoSoundLayer } from "@piano/core";

export const soundTypes: readonly { name: string; layer: PianoSoundLayer }[] = [
    { name: "长音(4s)", layer: "long" },
    { name: "标准音(2s)", layer: "standard" },
    { name: "短音(0.5s)", layer: "short" },
];
