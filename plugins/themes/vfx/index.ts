import type { VfxPluginManifest, VfxPluginModule, VfxTheme } from "@piano/vfx";
import rawManifest from "../plugin.json";

const BUILTIN_THEMES: Readonly<Record<string, VfxTheme>> = {
    galaxy: {
        label: "梦幻星河",
        keyParticle: { style: "blue_tears", colors: ["#8EB8FF", "#C58CFF"], glimmer: true },
        layers: [
            {
                effect: "starfield",
                variant: "volume",
                color: "#9EBCFF",
                level: { input: "activity", from: 46, to: 83 },
            },
            {
                effect: "aurora_veil",
                color: "#9CBAFF",
                level: { input: "activity", from: 58, to: 85 },
            },
            {
                effect: "silk_streams",
                slot: 0,
                variant: "right",
                color: "#A0CAFF",
                level: { input: "activity", from: 46, to: 96 },
            },
            {
                effect: "silk_streams",
                slot: 1,
                variant: "left",
                color: "#AF8AF6",
                level: { input: "activity", from: 40, to: 73 },
            },
        ],
    },
    neon: {
        label: "霓虹音乐会",
        keyParticle: { style: "neon_note", colors: ["#4EEBFF", "#C58CFF"], glimmer: true },
        layers: [
            {
                effect: "light_pillars",
                slot: 0,
                variant: "neon_sides",
                color: "#70CCFF",
                level: { input: "activity", from: 25, to: 57 },
            },
            {
                effect: "light_pillars",
                slot: 1,
                variant: "neon_rear",
                color: "#B4A0FF",
                level: { input: "density", from: 20, to: 47 },
            },
        ],
    },
    stage: {
        label: "高能舞台",
        keyParticle: { style: "magic_trail", colors: ["#FFB870", "#FFE29A"], glimmer: true },
        layers: [
            {
                effect: "wing_curtain",
                color: "#FFAD65",
                level: { input: "surge", from: 7, to: 91 },
            },
            {
                effect: "light_pillars",
                variant: "backline",
                color: "#B57BE4",
                level: { input: "activity", from: 20, to: 49 },
            },
            {
                effect: "crown_fan",
                color: "#FFB467",
                level: { input: "surge", from: 0, to: 100 },
            },
            {
                effect: "firefly_rise",
                variant: "fountain",
                color: "#FFB37A",
                level: { input: "surge", from: 0, to: 62 },
            },
        ],
    },
    sakura: {
        label: "落樱星庭",
        keyParticle: { style: "sakura_drift", colors: ["#FFB7D5", "#FFF4DC"], glimmer: true },
        layers: [
            {
                effect: "petal_fall",
                color: "#FFB7D5",
                color2: "#FFF4DC",
                brush: "petal",
                zone: "high",
                level: { input: "activity", from: 45, to: 88 },
            },
            {
                effect: "firefly_rise",
                color: "#FFE29A",
                color2: "#FFB7D5",
                brush: "mote",
                zone: "low",
                level: { input: "activity", from: 35, to: 75 },
            },
            {
                effect: "silk_streams",
                color: "#FFB7D5",
                color2: "#D6EAFF",
                level: { input: "sustain", from: 30, to: 82 },
            },
            {
                effect: "key_fountain",
                color: "#FFB7D5",
                color2: "#FFE29A",
                brush: "petal",
                level: 78,
            },
        ],
    },
    starlight: {
        label: "星空法阵",
        keyParticle: { style: "stardust", colors: ["#8EB8FF", "#68E4FF"], glimmer: true },
        layers: [
            {
                effect: "starfield",
                color: "#8EB8FF",
                color2: "#D6EAFF",
                motion: "gentle",
                level: 55,
            },
            {
                effect: "magic_circle",
                color: "#68E4FF",
                color2: "#C58CFF",
                level: { input: "activity", from: 45, to: 90 },
            },
            {
                effect: "double_helix",
                color: "#7C92FF",
                color2: "#4EEBFF",
                brush: "star",
                level: { input: "surge", from: 25, to: 88 },
            },
            {
                effect: "key_constellation",
                color: "#D6EAFF",
                color2: "#68E4FF",
                brush: "star",
                level: 82,
            },
        ],
    },
    cathedral: {
        label: "圣光时空",
        keyParticle: { style: "magic_trail", colors: ["#D6EAFF", "#FFE29A"], glimmer: true },
        layers: [
            {
                effect: "aurora_veil",
                color: "#7C92FF",
                color2: "#68E4FF",
                level: { input: "activity", from: 52, to: 88 },
            },
            {
                effect: "portal_arch",
                color: "#8EB8FF",
                color2: "#FFE29A",
                level: { input: "sustain", from: 35, to: 92 },
            },
            {
                effect: "crown_fan",
                color: "#FFE29A",
                color2: "#FFB870",
                level: { input: "surge", from: 0, to: 95 },
            },
            {
                effect: "key_notes",
                color: "#D6EAFF",
                color2: "#FFE29A",
                brush: "note",
                level: 84,
            },
            {
                effect: "prism_rewind",
                color: "#68E4FF",
                color2: "#FFE29A",
                level: 78,
                gate: { input: "surge", threshold: 0.72, cooldown: 52 },
            },
        ],
    },
    carnival: {
        label: "璀璨烟花夜",
        keyParticle: { style: "prism_shards", colors: ["#FFB870", "#FF8DA8"], glimmer: true },
        layers: [
            {
                effect: "firefly_rise",
                color: "#FFB870",
                color2: "#FF8DA8",
                brush: "mote",
                level: 58,
            },
            {
                effect: "wing_ribbons",
                color: "#FFB870",
                color2: "#FF8DA8",
                level: { input: "activity", from: 38, to: 90 },
            },
            {
                effect: "light_pillars",
                color: "#4EEBFF",
                color2: "#C58CFF",
                level: { input: "density", from: 32, to: 78 },
            },
            {
                effect: "firework_bloom",
                color: "#FFE29A",
                color2: "#FF8DA8",
                level: 85,
                gate: { input: "chord", threshold: 0.35, cooldown: 36 },
            },
        ],
    },
};

export const themesPlugin: VfxPluginModule = {
    manifest: rawManifest as VfxPluginManifest,
    register(api) {
        for (const [id, theme] of Object.entries(BUILTIN_THEMES)) {
            api.registerTheme(id, theme);
        }
    },
};

export default themesPlugin;
