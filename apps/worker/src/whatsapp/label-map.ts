// WhatsApp Business labels into Konva labels. Pure: turns a WhatsApp label (a name and a colour number 0 to 19) into a name and
// one of Konva's nine palette colours, and a chat's JIDs into the indexes its conversation is found by. One way only:
// WhatsApp is the source, Konva never writes labels back.

import type { BaileysEventMap } from "baileys";

type Label = BaileysEventMap["labels.edit"];

/** Konva's palette (labels.color check); apps/web/lib/labels.ts lists the same ones. */
const PALETTE = ["gray", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink"] as const;
export type KonvaColor = (typeof PALETTE)[number];

/** Longest label name Konva shows (apps/web/lib/labels.ts NAME_MAX). */
const NAME_MAX = 40;

/**
 * WhatsApp's twenty label colours, by number, to the nearest of Konva's. Business shows them in a fixed order from a warm
 * orange through greens and blues to pinks and greys; a number outside 0 to 19 is grey.
 */
const COLOUR: KonvaColor[] = [
  "orange", "blue", "teal", "amber", "green", "violet", "pink", "red", "teal", "blue",
  "orange", "green", "violet", "pink", "red", "amber", "blue", "teal", "gray", "gray",
];

export function colourOf(color: number | null | undefined): KonvaColor {
  return typeof color === "number" && Number.isInteger(color) && color >= 0 && color < COLOUR.length ? COLOUR[color] : "gray";
}

/** A WhatsApp label as Konva stores it, or null when it has no usable name. `deleted` removes it. */
export function mapLabel(label: Pick<Label, "id" | "name" | "color" | "deleted">): { waId: string; name: string; color: KonvaColor; deleted: boolean } | null {
  if (!label.id) return null;
  const name = (label.name ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
  if (!name && !label.deleted) return null;
  return { waId: label.id, name, color: colourOf(label.color), deleted: !!label.deleted };
}

/**
 * Whether a label association is about a whole chat, which Konva shows as a label on the conversation. A label on one message
 * has no equivalent here and is left out.
 */
export function isChatAssociation(type: string): boolean {
  return type === "label_jid";
}
