import { describe, expect, it } from "vitest";
import { homeworkHidden, homeworkReleases, profiles } from "../../mocks/fixtures";
import { families, filterReleases, hiddenReason, isComplete, sizeText, trackTitle } from "../releases";

const releases = homeworkReleases();
const profile = profiles()[0];

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

describe("hiddenReason", () => {
  const hidden = homeworkHidden();
  it("names the queue when it is over the profile limit", () => {
    const longQueue = hidden.find((r) => r.best.source.queueLen === 120)!;
    expect(hiddenReason(longQueue, profile)).toBe("Queue of 120, your limit is 50");
  });
  it("does not blame a queue exactly at the limit", () => {
    const atLimit = { ...hidden[0], best: { ...hidden[0].best, source: { ...hidden[0].best.source, queueLen: 50 } } };
    expect(hiddenReason(atLimit, profile)).toBe("Below your profile");
  });
  it("falls back to the format when no profile is loaded", () => {
    expect(hiddenReason(hidden[2], undefined)).toBe("Below your profile");
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
