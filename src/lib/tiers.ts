import type { Codec } from "../bindings/Codec";
import type { Tier } from "../bindings/Tier";
import { codecName, losslessCodecs } from "./format";

export const isLosslessTier = (t: Tier) => t.codecs.length > 0 && t.codecs.every((c) => losslessCodecs.includes(c));

/** The muted text on the right of a tier row: "44.1 kHz or higher", "CBR or V0". */
export function tierDetail(t: Tier): string {
  if (isLosslessTier(t)) return t.minSampleRate ? `${t.minSampleRate / 1000} kHz or higher` : "any sample rate";
  const parts: string[] = [];
  if (t.minBitrateKbps) parts.push(t.allowVbr ? (t.codecs.includes("mp3") ? "CBR or V0" : "CBR or VBR") : "CBR only");
  else parts.push(t.codecs.map((c: Codec) => codecName[c]).join(", ") || "any format");
  return parts.join(" · ");
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

export const emptyTier = (): Tier => ({ label: "", codecs: ["flac"], minBitDepth: 16, minSampleRate: 44100, minBitrateKbps: null, allowVbr: false });
