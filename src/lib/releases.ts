import type { QualityProfile } from "../bindings/QualityProfile";
import type { Release } from "../bindings/Release";
import { baseName, bytes, formatFamily, isAudio, num, speed } from "./format";
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

/**
 * Why a release is hidden. The contract has no reason field, so this mirrors
 * the backend's rules: queue over the limit, otherwise below every tier.
 */
export function hiddenReason(r: Release, profile: QualityProfile | undefined): string {
  const q = r.best.source.queueLen;
  if (profile && q !== null && q > profile.maxQueue) return `Queue of ${num(q)}, your limit is ${num(profile.maxQueue)}`;
  return "Below your profile";
}

export function availability(r: Release): { tone: Tone; text: string } {
  const s = r.best.source;
  return s.freeSlot
    ? { tone: "ok", text: `Free · ${speed(s.avgSpeed)}` }
    : { tone: "idle", text: `Queue ${s.queueLen ?? "?"} · ${speed(s.avgSpeed)}` };
}

export function sizeText(r: Release): { text: string; partial: boolean } {
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

/** The path sent to owned_check for a release: its first audio file. */
export const ownedKey = (r: Release) => audioFiles(r)[0]?.path ?? r.best.folder;
