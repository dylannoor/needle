import { afterEach, describe, expect, it, vi } from "vitest";

/** A fake `needle` global backed by in-memory storage and files. */
function fakeNeedle({ settings = {}, library } = {}) {
  const store = new Map([["settings", settings]]);
  if (library) store.set("library", library);
  const handlers = new Map();
  const needle = {
    files: new Map(),
    on: (name, h) => handlers.set(name, h),
    emit: (name, payload) => handlers.get(name)(payload),
    storage: {
      get: vi.fn(async (k) => store.get(k) ?? null),
      set: vi.fn(async (k, v) => void store.set(k, v)),
    },
    settings: { get: async () => store.get("settings") },
    fs: {
      writeText: vi.fn(async (path, text) => {
        if (!path.startsWith("~/Music/")) throw new Error(`no permission to write ${path}`);
        needle.files.set(path, text);
      }),
    },
    notify: vi.fn(async () => null),
    store,
  };
  return needle;
}

function file(n, over = {}) {
  return {
    jobId: "job-1",
    localPath: `/Users/me/Music/Needle/Album/0${n} Track.flac`,
    title: `Track ${n}`,
    artist: "Artist",
    album: "Album",
    trackNumber: n,
    durationSecs: 200,
    codec: "flac",
    sampleRate: 44100,
    bitDepth: 16,
    bitrateKbps: 900,
    size: 22500000,
    ...over,
  };
}

/** `download.completed` is one per job; localPath is the job's folder. */
function completed(jobId) {
  return { ...file(0), jobId, localPath: "/Users/me/Music/Needle/Album", codec: "other", trackNumber: null };
}

async function load(needle) {
  vi.stubGlobal("needle", needle);
  vi.resetModules();
  const mod = await import("../worker.js");
  await new Promise((r) => setTimeout(r, 0));
  return mod;
}

const PATH = "~/Music/Needle/rekordbox.xml";

afterEach(() => vi.unstubAllGlobals());

describe("rekordbox worker", () => {
  it("adds verified downloads to the stored library and rewrites the XML", async () => {
    const needle = fakeNeedle();
    await load(needle);
    await needle.emit("download.verified", file(1));
    await needle.emit("download.verified", file(2));
    expect(needle.store.get("library").map((t) => t.title)).toEqual(["Track 1", "Track 2"]);
    const xml = needle.files.get(PATH);
    expect(xml).toContain('<COLLECTION Entries="2">');
    expect(xml).toContain('Name="Needle" Type="1" KeyType="0" Entries="2"');
  });

  it("does not add the same path twice", async () => {
    const needle = fakeNeedle();
    await load(needle);
    await needle.emit("download.verified", file(1));
    await needle.emit("download.verified", file(1));
    expect(needle.store.get("library")).toHaveLength(1);
    expect(needle.storage.set).toHaveBeenCalledTimes(1);
  });

  it("handles events arriving at once one after another", async () => {
    const needle = fakeNeedle();
    await load(needle);
    await Promise.all([1, 2, 3].map((n) => needle.emit("download.verified", file(n))));
    expect(needle.store.get("library")).toHaveLength(3);
  });

  it("uses the configured path, playlist name and per-release layout", async () => {
    const needle = fakeNeedle({ settings: { xmlPath: "~/Music/dj/needle.xml", playlistName: "Fresh", perRelease: true } });
    await load(needle);
    await needle.emit("download.verified", file(1));
    const xml = needle.files.get("~/Music/dj/needle.xml");
    expect(xml).toContain('<NODE Type="0" Name="Fresh" Count="1">');
    expect(xml).toContain('<NODE Name="Artist - Album" Type="1"');
  });

  it("notifies once per job when the job completes, counting its added tracks", async () => {
    const needle = fakeNeedle();
    await load(needle);
    for (const n of [1, 2, 3]) await needle.emit("download.verified", file(n));
    await needle.emit("download.verified", file(4, { jobId: "job-2" }));
    expect(needle.notify).not.toHaveBeenCalled();
    await needle.emit("download.completed", completed("job-1"));
    expect(needle.notify).toHaveBeenCalledTimes(1);
    expect(needle.notify).toHaveBeenCalledWith("Added 3 tracks to the Needle playlist", PATH);
    await needle.emit("download.completed", completed("job-2"));
    expect(needle.notify).toHaveBeenLastCalledWith("Added 1 track to the Needle playlist", PATH);
  });

  it("notifies after files that arrive just before the completion", async () => {
    const needle = fakeNeedle();
    await load(needle);
    const pending = [1, 2].map((n) => needle.emit("download.verified", file(n)));
    await Promise.all([...pending, needle.emit("download.completed", completed("job-1"))]);
    expect(needle.notify).toHaveBeenCalledWith("Added 2 tracks to the Needle playlist", PATH);
  });

  it("names the playlist and per-release mode in the notification", async () => {
    const needle = fakeNeedle({ settings: { playlistName: "Fresh" } });
    await load(needle);
    await needle.emit("download.verified", file(1));
    await needle.emit("download.completed", completed("job-1"));
    expect(needle.notify).toHaveBeenLastCalledWith("Added 1 track to the Fresh playlist", PATH);
    needle.store.set("settings", { perRelease: true });
    await needle.emit("download.verified", file(2, { jobId: "job-2" }));
    await needle.emit("download.completed", completed("job-2"));
    expect(needle.notify).toHaveBeenLastCalledWith("Added 1 track to Rekordbox", PATH);
  });

  it("notifies only once per job", async () => {
    const needle = fakeNeedle();
    await load(needle);
    await needle.emit("download.verified", file(1));
    await needle.emit("download.completed", completed("job-1"));
    await needle.emit("download.completed", completed("job-1"));
    expect(needle.notify).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for a job that added nothing new", async () => {
    const needle = fakeNeedle({ library: [file(1)] });
    await load(needle);
    await needle.emit("download.verified", file(1));
    await needle.emit("download.completed", completed("job-1"));
    await needle.emit("download.completed", completed("unknown-job"));
    expect(needle.notify).not.toHaveBeenCalled();
  });

  it("does not add the completed job's folder as a track", async () => {
    const needle = fakeNeedle();
    await load(needle);
    await needle.emit("download.completed", completed("job-1"));
    expect(needle.storage.set).not.toHaveBeenCalled();
    expect(needle.fs.writeText).not.toHaveBeenCalled();
  });

  it("rewrites the XML on start when the library is not empty", async () => {
    const needle = fakeNeedle({ library: [file(1)], settings: { xmlPath: "~/Music/moved.xml" } });
    await load(needle);
    expect(needle.files.get("~/Music/moved.xml")).toContain('<COLLECTION Entries="1">');
  });

  it("does not write on start with an empty library", async () => {
    const needle = fakeNeedle();
    await load(needle);
    expect(needle.fs.writeText).not.toHaveBeenCalled();
  });

  it("surfaces a denied write and keeps handling later events", async () => {
    const needle = fakeNeedle({ settings: { xmlPath: "/etc/rekordbox.xml" } });
    await load(needle);
    await expect(needle.emit("download.verified", file(1))).rejects.toThrow("no permission");
    needle.store.set("settings", {});
    await needle.emit("download.verified", file(2));
    expect(needle.files.get(PATH)).toContain('<COLLECTION Entries="2">');
  });
});
