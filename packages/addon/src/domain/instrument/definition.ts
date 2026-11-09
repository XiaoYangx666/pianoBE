import { GRAND_PARTS } from "@data/grand.generated";

/** Definitions describe an assembly relative to its anchor; positions are world-specific. */
export interface InstrumentDefinition {
    readonly parts: readonly { typeId: string; right: number; forward?: number; up?: number }[];
    readonly itemId: string;
    readonly displayId?: string;
}

export const pianoDefinition: InstrumentDefinition = {
    parts: [{ typeId: "xypiano:piano_left", right: 0 }, { typeId: "xypiano:piano_right", right: 1 }],
    itemId: "xypiano:piano_item",
};

export const grandDefinition: InstrumentDefinition = {
    parts: GRAND_PARTS,
    itemId: "xypiano:grand_piano_item",
    displayId: "xypiano:grand_display",
};

const definitionsByPart = new Map(
    [pianoDefinition, grandDefinition].flatMap(definition =>
        definition.parts.map(part => [part.typeId, definition] as const)),
);

export const instrumentBlockTypes = [...definitionsByPart.keys()];

export function definitionForPart(typeId: string): InstrumentDefinition | undefined {
    return definitionsByPart.get(typeId);
}
