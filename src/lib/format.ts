import type { Codec } from "../bindings/Codec";
import type { FileInfo } from "../bindings/FileInfo";
import type { Presence } from "../bindings/Presence";

const nf = new Intl.NumberFormat("en-US");
export const num = (n: number) => nf.format(n);

/** 482 MB, 1.6 GB, 840 KB. Decimal units, like Finder. */
export function bytes(n: number): string {
  if (n < 1000) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let i = -1;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")} ${units[i]}`;
}

export const speed = (bytesPerSec: number) => `${bytes(bytesPerSec)}/s`;

/** "7:40" */
export function clock(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "2 min left", "40 s left" */
export function eta(secs: number): string {
  if (secs < 60) return `${Math.max(1, Math.round(secs))} s left`;
  if (secs < 3600) return `${Math.round(secs / 60)} min left`;
  return `${Math.floor(secs / 3600)} h ${Math.round((secs % 3600) / 60)} min left`;
}

/** "14:07" */
export const timeOfDay = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** "2 min ago", "today 09:12", "3 Oct" */
export function ago(ms: number, now = Date.now()): string {
  const d = Math.max(0, now - ms);
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  const then = new Date(ms);
  if (then.toDateString() === new Date(now).toDateString()) return `today ${timeOfDay(ms)}`;
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Last part of a Soulseek path (`\` separated) or a local path. */
export const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export const audioCodecs: Codec[] = ["flac", "alac", "wav", "aiff", "mp3", "aac", "ogg", "opus"];
export const losslessCodecs: Codec[] = ["flac", "alac", "wav", "aiff"];
export const isAudio = (f: FileInfo) => f.codec !== "other";

export const codecName: Record<Codec, string> = {
  flac: "FLAC",
  alac: "ALAC",
  wav: "WAV",
  aiff: "AIFF",
  mp3: "MP3",
  aac: "AAC",
  ogg: "Ogg Vorbis",
  opus: "Opus",
  other: "Other",
};

/** Filter chip family for a release format label: "FLAC 16/44.1" -> "FLAC", "MP3 320" stays. */
export function formatFamily(label: string): string {
  const first = label.split(" ")[0];
  return ["FLAC", "ALAC", "WAV", "AIFF"].includes(first) ? first : label;
}

export const isLossyLabel = (label: string) => !["FLAC", "ALAC", "WAV", "AIFF"].includes(label.split(" ")[0]);

export const presenceLabel: Record<Presence, string> = {
  online: "Online",
  away: "Away",
  offline: "Offline",
  unknown: "Unknown",
};

export const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
