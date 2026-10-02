import { describe, expect, it } from "vitest";
import { jobs } from "../../mocks/fixtures";
import { jobMeta, jobStatus, rejectedItem } from "../jobs";
import { describePermission, describePermissions } from "../permissions";

const byId = (id: string) => jobs().find((j) => j.id === id)!;

describe("jobStatus", () => {
  it("reads a recovering job in plain language", () => {
    expect(jobStatus(byId("j2"))).toEqual({ tone: "warn", text: "Replacing 03 - Washing Machine.flac", sub: "failed the lossless check" });
  });
  it("counts the file being downloaded", () => {
    expect(jobStatus(byId("j1")).text).toBe("Downloading 10 of 16");
  });
  it("calls out a recent source switch", () => {
    expect(jobStatus(byId("j3"))).toMatchObject({ tone: "warn", text: "Switched source" });
  });
  it("stops calling it switched once the switch is old", () => {
    const j = byId("j3");
    expect(jobStatus(j, j.log[0].atMs + 6 * 60_000).text).toBe("Downloading 3 of 6");
  });
  it("shows queue position and failures", () => {
    // The library often doesn't know the position.
    expect(jobStatus(byId("j4")).text).toBe("Queued");
    expect(jobStatus({ ...byId("j4"), status: { kind: "queued", position: 14 } }).text).toBe("Position 14 in queue");
    expect(jobStatus({ ...byId("j1"), status: { kind: "failed", reason: "No source left" } })).toMatchObject({ tone: "bad", sub: "No source left" });
  });
});

describe("jobMeta", () => {
  it("shows the countdown while queued", () => {
    expect(jobMeta(byId("j4"))).toBe("next source in 7:40");
  });
  it("shows percent, speed and time left while downloading", () => {
    expect(jobMeta(byId("j1"))).toBe("62% · 1.9 MB/s · 2 min left");
  });
  it("shows the source while recovering", () => {
    expect(jobMeta(byId("j2"))).toBe("81% · source 2 of 5");
  });
  it("handles a job with no size yet", () => {
    expect(jobMeta({ ...byId("j1"), total: 0, bytes: 0, speed: 0 })).toBe("0%");
  });
});

describe("rejectedItem", () => {
  it("finds the file that failed verification", () => {
    expect(rejectedItem(byId("j2"))?.name).toBe("03 - Washing Machine.flac");
    expect(rejectedItem(byId("j1"))).toBeUndefined();
  });
});

describe("permissions", () => {
  it.each([
    ["events:download.verified", "Get told when a download passes the quality check"],
    ["fs:write:~/Music/rekordbox", "Read and write files in ~/Music/rekordbox"],
    ["fs:read:~/Music", "Read files in ~/Music"],
    ["notify", "Show notifications"],
    ["jobs:read", "See your downloads"],
    ["events:custom.thing", "Get told about custom.thing events"],
    ["something:else", "something:else"],
  ])("%s", (p, text) => expect(describePermission(p)).toBe(text));

  it("keeps fs:read for a folder that is not also writable", () => {
    expect(describePermissions(["fs:read:~/A", "fs:write:~/B"])).toEqual(["Read files in ~/A", "Read and write files in ~/B"]);
  });
});
