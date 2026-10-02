import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchView } from "../../bindings/SearchView";
import type { JobView } from "../../bindings/JobView";
import { api, on } from "../../lib/ipc";
import { createMockBackend } from "../backend";

// The app talks to the mock through lib/ipc when not inside Tauri; these tests
// go through that same path.
describe("mock ipc", () => {
  afterEach(() => vi.useRealTimers());

  it("streams search results and finishes with done", async () => {
    const updates: SearchView[] = [];
    const off = on("search:update", (v) => updates.push(v));
    const id = await api.searchStart("Daft Punk Homework", null);
    await vi.waitFor(() => expect(updates.at(-1)?.done).toBe(true), { timeout: 2000 });
    off();
    expect(updates[0].searchId).toBe(id);
    expect(updates[0].done).toBe(false);
    expect(updates.at(-1)!.releases).toHaveLength(6);
    expect(await api.searchHistory()).toContain("Daft Punk Homework");
  });

  it("only returns hidden releases when asked", async () => {
    const id = await api.searchStart("Daft Punk Homework", null);
    expect((await api.searchView(id, null, false)).hiddenReleases).toHaveLength(0);
    expect((await api.searchView(id, null, true)).hiddenReleases).toHaveLength(4);
  });

  it("rejects an empty search with a plain message", async () => {
    await expect(api.searchStart("  ", null)).rejects.toBe("Type something to search for.");
  });

  it("stops delivering events after unsubscribing", async () => {
    const cb = vi.fn();
    const off = on("jobs:update", cb);
    await api.jobPause("j1");
    await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(1));
    off();
    await api.jobResume("j1");
    await new Promise((r) => setTimeout(r, 20));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("emits the changed job on keep-anyway", async () => {
    const seen: JobView[] = [];
    const off = on("jobs:update", (j) => seen.push(j));
    const job = await api.jobKeepFile("j2", "03 - Washing Machine.flac");
    off();
    expect(job.items[2].state).toEqual({ kind: "keptAnyway" });
    expect(seen.at(-1)?.id).toBe("j2");
    await expect(api.jobKeepFile("j2", "nope.flac")).rejects.toBe("That file is not part of this download.");
  });

  it("answers login with connecting and reports the outcome as an event", async () => {
    await api.logout();
    const seen: string[] = [];
    const off = on("session", (s) => seen.push(`${s.state}:${s.error ?? ""}`));
    await expect(api.login("", "x", false)).rejects.toBe("Enter your username and password.");
    expect(await api.login("dj", "wrong", false)).toMatchObject({ state: "connecting" });
    await vi.waitFor(() => expect(seen.at(-1)).toMatch(/^error:That password doesn't match/));
    expect(await api.login("dj", "secret", true)).toMatchObject({ state: "connecting", remembered: true });
    await vi.waitFor(() => expect(seen.at(-1)).toBe("online:"));
    off();
    expect((await api.logout()).state).toBe("offline");
  });

  it("refuses to delete the built-in profile and to save a profile without tiers", async () => {
    await expect(api.profileDelete("lossless-first")).rejects.toMatch(/can't be deleted/);
    const [p] = await api.profilesList();
    await expect(api.profileSave({ ...p, tiers: [] })).rejects.toMatch(/at least one tier/);
  });

  it("returns copies, so callers can't mutate backend state", async () => {
    const a = await api.buddiesList();
    a[0].note = "changed";
    expect((await api.buddiesList())[0].note).not.toBe("changed");
  });

  it("errors on unknown commands", async () => {
    const b = createMockBackend();
    await expect(b.invoke("nope")).rejects.toBe("Unknown command nope");
  });
});
