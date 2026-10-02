import type { OwnedQuery } from "../bindings/OwnedQuery";
import type { Release } from "../bindings/Release";
import { baseName, bytes, formatFamily, isAudio, speed } from "./format";
import type { Tone } from "../components/ui/status";

export const isComplete = (r: Release) => r.trackCount >= r.expectedTracks;

/** Codec families present, in result order: ["FLAC", "MP3 320"]. */
export function families(releases: Release[]): string[] {
  return [...new Set(releases.map((r) => formatFamily(r.formatLabel)))];
}

export interface ReleaseFilter {
  /** Families the user switched off. */
  off: ReadonlySet<string>;
  completeOnly: boolean;
}

export function filterReleases(releases: Release[], f: ReleaseFilter): Release[] {
  return releases.filter((r) => !f.off.has(formatFamily(r.formatLabel)) && (!f.completeOnly || isComplete(r)));
}

export function availability(r: Release): { tone: Tone; text: string } {
  const s = r.best.source;
  return s.freeSlot
    ? { tone: "ok", text: `Free · ${speed(s.avgSpeed)}` }
    : { tone: "idle", text: `${s.queueLen === null ? "No free slot" : `Queue ${s.queueLen}`} · ${speed(s.avgSpeed)}` };
}

export function sizeText(r: Release): { text: string; partial: boolean } {
  // Folders without audio (scans, artwork) only show up among hidden releases.
  if (r.trackCount === 0) {
    const n = r.best.files.length;
    return { text: `${n} ${n === 1 ? "file" : "files"} · ${bytes(r.best.totalSize)}`, partial: false };
  }
  const partial = !isComplete(r);
  const count = partial ? `${r.trackCount} of ${r.expectedTracks}` : `${r.trackCount} ${r.trackCount === 1 ? "track" : "tracks"}`;
  return { text: `${count} · ${bytes(r.best.totalSize)}`, partial };
}

/** "01 - Da Funk.flac" -> "Da Funk" */
export const trackTitle = (path: string) =>
  baseName(path)
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/^\d{1,3}\s*[-._)]\s*/, "");

export const audioFiles = (r: Release) => r.best.files.filter(isAudio);

/** What owned_check gets for a release: its first audio file (name + size). */
export function ownedQuery(r: Release): OwnedQuery {
  const f = audioFiles(r)[0] ?? r.best.files[0];
  return f ? { path: f.path, size: f.size } : { path: r.best.folder, size: 0 };
}
