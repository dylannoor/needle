import { describe, expect, it } from "vitest";
import { homeworkReleases } from "../../mocks/fixtures";
import { families, filterReleases, isComplete, ownedQuery, sizeText, trackTitle } from "../releases";

const releases = homeworkReleases();

describe("families", () => {
  it("lists codec families in result order without duplicates", () => {
    expect(families(releases)).toEqual(["FLAC", "MP3 320"]);
  });
  it("is empty for no releases", () => {
    expect(families([])).toEqual([]);
  });
});

describe("filterReleases", () => {
  it("keeps everything with no filters", () => {
    expect(filterReleases(releases, { off: new Set(), completeOnly: false })).toHaveLength(6);
  });
  it("drops families that are switched off", () => {
    const out = filterReleases(releases, { off: new Set(["FLAC"]), completeOnly: false });
    expect(out.map((r) => r.best.source.username)).toEqual(["motorcity_wax", "lowend_theory"]);
  });
  it("drops incomplete copies with Complete only", () => {
    const out = filterReleases(releases, { off: new Set(), completeOnly: true });
    expect(out.map((r) => r.best.source.username)).not.toContain("planet_e_fan");
    expect(out).toHaveLength(5);
  });
  it("returns nothing when every family is off", () => {
    expect(filterReleases(releases, { off: new Set(["FLAC", "MP3 320"]), completeOnly: false })).toEqual([]);
  });
});

describe("isComplete and sizeText", () => {
  it("flags a copy with fewer tracks than seen elsewhere", () => {
    const partial = releases.find((r) => r.best.source.username === "planet_e_fan")!;
    expect(isComplete(partial)).toBe(false);
    expect(sizeText(partial)).toEqual({ text: "14 of 16 · 422 MB", partial: true });
  });
  it("counts exactly-equal track counts as complete", () => {
    expect(isComplete(releases[0])).toBe(true);
    expect(sizeText(releases[0]).text).toBe("16 tracks · 483 MB");
  });
});

describe("ownedQuery", () => {
  it("asks about the first audio file by path and size, not the cover", () => {
    const q = ownedQuery(releases[0]);
    expect(q.path).toMatch(/01 - Daftendirekt\.flac$/);
    expect(q.size).toBe(releases[0].best.files[0].size);
  });
  it("falls back to the folder when a release has no files", () => {
    const empty = { ...releases[0], best: { ...releases[0].best, files: [] } };
    expect(ownedQuery(empty)).toEqual({ path: releases[0].best.folder, size: 0 });
  });
});

describe("trackTitle", () => {
  it.each([
    ["@@music\\Daft Punk\\01 - Da Funk.flac", "Da Funk"],
    ["03. Revolution 909.mp3", "Revolution 909"],
    ["Teachers.flac", "Teachers"],
    ["2 Unlimited - No Limit.mp3", "2 Unlimited - No Limit"],
  ])("%s -> %s", (path, title) => {
    expect(trackTitle(path)).toBe(title);
  });
});

describe("availability", () => {
  it("says a busy peer has no free slot when the queue length is unknown", async () => {
    const { availability } = await import("../releases");
    const busy = releases.find((r) => r.best.source.username === "kdj_archive")!;
    expect(availability(busy)).toEqual({ tone: "idle", text: "No free slot · 840 KB/s" });
    expect(availability({ ...busy, best: { ...busy.best, source: { ...busy.best.source, queueLen: 3 } } }).text).toBe("Queue 3 · 840 KB/s");
    expect(availability(releases[0])).toEqual({ tone: "ok", text: "Free · 2.1 MB/s" });
  });
});
