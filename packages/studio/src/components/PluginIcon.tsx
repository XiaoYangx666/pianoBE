import { AudioWaveform, Music2, Sparkles } from "lucide-react";
import type { StudioPlugin } from "../adapters/types";

export interface PluginIconProps {
    plugin: Pick<
        StudioPlugin,
        "name" | "icon" | "previewDataUrl" | "contents" | "timbreEntries" | "provides"
    >;
    size?: "md" | "lg";
}

const SIZE_CLASSES = {
    md: { box: "h-11 w-11 rounded-lg", glyph: "text-[16px]", icon: 18 },
    lg: { box: "h-14 w-14 rounded-xl", glyph: "text-[20px]", icon: 22 },
} as const;

export function PluginIcon({ plugin, size = "md" }: PluginIconProps) {
    const dim = SIZE_CLASSES[size];

    if (plugin.previewDataUrl) {
        return (
            <img
                src={plugin.previewDataUrl}
                alt={plugin.name}
                className={`${dim.box} shrink-0 border border-ore-divider bg-ore-sunken object-cover`}
            />
        );
    }

    if (plugin.icon && typeof plugin.icon === "object" && typeof plugin.icon.text === "string") {
        const color = plugin.icon.color ?? "#14b8a6";
        const compact = [...plugin.icon.text].length > 2;
        return (
            <div
                aria-hidden="true"
                className={`grid ${dim.box} shrink-0 place-items-center border font-semibold tracking-tight select-none ${
                    compact ? "text-[12px]" : dim.glyph
                }`}
                style={{
                    backgroundColor: `${color}1f`,
                    borderColor: `${color}55`,
                    color,
                }}
            >
                {plugin.icon.text}
            </div>
        );
    }

    const isTimbre = Boolean(
        plugin.contents.timbres || plugin.timbreEntries?.length || plugin.provides.timbres?.length,
    );
    const hasSongs = plugin.contents.songs > 0;

    return (
        <div
            className={`grid ${dim.box} shrink-0 place-items-center border border-ore-divider bg-ore-sunken text-ore-dim`}
        >
            {isTimbre ? (
                <AudioWaveform size={dim.icon} />
            ) : hasSongs ? (
                <Music2 size={dim.icon} />
            ) : (
                <Sparkles size={dim.icon} />
            )}
        </div>
    );
}
