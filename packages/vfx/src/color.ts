import { parsePerformanceRgb } from "@piano/core";
import { clampUnit, mix } from "./music";

export function rgbToHex(r: number, g: number, b: number): string {
    const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0").toUpperCase();
    return `#${byte(r)}${byte(g)}${byte(b)}`;
}

export function hexToUnitRgb(hex: string): { red: number; green: number; blue: number } {
    const [r, g, b] = parsePerformanceRgb(hex);
    return { red: r / 255, green: g / 255, blue: b / 255 };
}

export function blendHex(fromHex: string, toHex: string, t: number): string {
    const [r1, g1, b1] = parsePerformanceRgb(fromHex);
    const [r2, g2, b2] = parsePerformanceRgb(toHex);
    const u = clampUnit(t);
    return rgbToHex(mix(r1, r2, u), mix(g1, g2, u), mix(b1, b2, u));
}

export function deriveAccentHex(hex: string, amount = 0.34): string {
    const [r, g, b] = parsePerformanceRgb(hex);
    const warm = r > b + 20;
    return rgbToHex(
        mix(r, warm ? 255 : 220, amount),
        mix(g, warm ? 242 : 244, amount),
        mix(b, warm ? 205 : 255, amount),
    );
}

export function pitchGradientHex(color: string, color2: string, midi: number): string {
    return blendHex(color, color2, (midi - 21) / 87);
}

export function colorVars(color: string, color2: string, opacity: number) {
    const c1 = hexToUnitRgb(color);
    const c2 = hexToUnitRgb(color2);
    return {
        red: c1.red,
        green: c1.green,
        blue: c1.blue,
        red2: c2.red,
        green2: c2.green,
        blue2: c2.blue,
        opacity: clampUnit(opacity),
    };
}
