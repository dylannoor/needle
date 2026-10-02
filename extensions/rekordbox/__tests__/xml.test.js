import { describe, expect, it } from "vitest";
import { addTrack, buildXml, escapeXml, fileUrl, kindOf } from "../xml.js";

function track(over = {}) {
  return {
    jobId: "job-1",
    localPath: "/Users/me/Music/Needle/Artist - Album/01 Song.flac",
    title: "Song",
    artist: "Artist",
    album: "Album",
    trackNumber: 1,
    durationSecs: 241,
    codec: "flac",
    sampleRate: 44100,
    bitDepth: 16,
    bitrateKbps: null,
    size: 30000000,
    ...over,
  };
}

function parse(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  return doc;
}

const collection = (doc) => [...doc.querySelectorAll("COLLECTION > TRACK")];

describe("escapeXml", () => {
  it("escapes markup and quotes", () => {
    expect(escapeXml(`a & b < c > d "e" 'f'`)).toBe("a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;");
  });

  it("drops characters XML 1.0 forbids but keeps tabs, newlines and emoji", () => {
    expect(escapeXml("a\u0000b\u0007c\u001Fd\uFFFE")).toBe("abcd");
    expect(escapeXml("a\tb\nc")).toBe("a\tb\nc");
    expect(escapeXml("x\uD800y\uDC00z")).toBe("xyz");
    expect(escapeXml("🎧")).toBe("🎧");
  });

  it("turns null and numbers into text", () => {
    expect(escapeXml(null)).toBe("");
    expect(escapeXml(undefined)).toBe("");
    expect(escapeXml(0)).toBe("0");
  });
});

describe("fileUrl", () => {
  it("encodes spaces and non-ASCII per segment and keeps slashes", () => {
    expect(fileUrl("/Users/me/Music/Björk - Début/01 Human Behaviour.flac")).toBe(
      "file://localhost/Users/me/Music/Bj%C3%B6rk%20-%20D%C3%A9but/01%20Human%20Behaviour.flac",
    );
  });

  it("encodes characters that would break the URL", () => {
    expect(fileUrl("/m/AC#DC?/50% & more.mp3")).toBe("file://localhost/m/AC%23DC%3F/50%25%20%26%20more.mp3");
  });

  it("handles Windows paths with a drive letter", () => {
    expect(fileUrl("C:\\Music\\Sigur Rós\\a.flac")).toBe("file://localhost/C:/Music/Sigur%20R%C3%B3s/a.flac");
  });
});

describe("kindOf", () => {
  it("maps codecs to Rekordbox kinds", () => {
    expect(kindOf("flac")).toBe("FLAC File");
    expect(kindOf("mp3")).toBe("MP3 File");
    expect(kindOf("wav")).toBe("WAV File");
    expect(kindOf("aiff")).toBe("AIFF File");
    expect(kindOf("alac")).toBe("M4A File");
    expect(kindOf("aac")).toBe("M4A File");
  });

  it("falls back to the file extension", () => {
    expect(kindOf("ogg", "/a/b.ogg")).toBe("OGG File");
    expect(kindOf("other", "/a/noext")).toBe("Audio File");
  });
});

describe("addTrack", () => {
  it("appends new paths and dedupes by path", () => {
    const a = addTrack([], track());
    expect(a.added).toBe(true);
    expect(a.library).toHaveLength(1);
    const again = addTrack(a.library, track({ title: "Renamed" }));
    expect(again.added).toBe(false);
    expect(again.library).toBe(a.library);
    expect(again.library[0].title).toBe("Song");
    const b = addTrack(a.library, track({ localPath: "/x/02.flac" }));
    expect(b.library.map((t) => t.localPath)).toEqual([track().localPath, "/x/02.flac"]);
  });

  it("ignores payloads without a path", () => {
    expect(addTrack([], null).added).toBe(false);
    expect(addTrack([], track({ localPath: "" })).added).toBe(false);
    expect(addTrack([], { title: "x" }).added).toBe(false);
  });
});

describe("buildXml", () => {
  it("writes a well-formed document with collection and playlist", () => {
    const lib = [track(), track({ localPath: "/x/02 Two.mp3", title: "Two", codec: "mp3", bitrateKbps: 320, trackNumber: 2 })];
    const xml = buildXml(lib, { playlistName: "Needle" });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<DJ_PLAYLISTS Version="1.0.0">')).toBe(true);
    const doc = parse(xml);
    expect(doc.querySelector("PRODUCT").getAttribute("Name")).toBe("Needle");
    expect(doc.querySelector("COLLECTION").getAttribute("Entries")).toBe("2");
    const [first, second] = collection(doc);
    expect(first.getAttribute("TrackID")).toBe("1");
    expect(first.getAttribute("Kind")).toBe("FLAC File");
    expect(first.getAttribute("TotalTime")).toBe("241");
    expect(first.getAttribute("SampleRate")).toBe("44100");
    expect(first.getAttribute("BitRate")).toBe("996");
    expect(first.getAttribute("Location")).toBe("file://localhost/Users/me/Music/Needle/Artist%20-%20Album/01%20Song.flac");
    expect(second.getAttribute("BitRate")).toBe("320");
    expect(second.getAttribute("TrackNumber")).toBe("2");

    const root = doc.querySelector("PLAYLISTS > NODE");
    expect(root.getAttribute("Name")).toBe("ROOT");
    expect(root.getAttribute("Type")).toBe("0");
    expect(root.getAttribute("Count")).toBe("1");
    const list = root.querySelector(":scope > NODE");
    expect(list.getAttribute("Name")).toBe("Needle");
    expect(list.getAttribute("Type")).toBe("1");
    expect(list.getAttribute("KeyType")).toBe("0");
    expect(list.getAttribute("Entries")).toBe("2");
    expect([...list.querySelectorAll("TRACK")].map((t) => t.getAttribute("Key"))).toEqual(["1", "2"]);
  });

  it("escapes hostile metadata so the document stays well-formed", () => {
    const evil = track({ title: `"><x a='1'/>&amp;`, artist: "A & B <C>", album: "\u0001Bad\u0002" });
    const doc = parse(buildXml([evil], { playlistName: `Set <"&'>` }));
    const t = collection(doc)[0];
    expect(t.getAttribute("Name")).toBe(`"><x a='1'/>&amp;`);
    expect(t.getAttribute("Artist")).toBe("A & B <C>");
    expect(t.getAttribute("Album")).toBe("Bad");
    expect(doc.querySelector("PLAYLISTS NODE NODE").getAttribute("Name")).toBe(`Set <"&'>`);
  });

  it("omits unknown numbers and uses empty text for missing tags", () => {
    const bare = { jobId: "j", localPath: "/a.wav", title: "A", artist: null, album: null, trackNumber: null, durationSecs: null, codec: "wav", sampleRate: null, bitDepth: null, bitrateKbps: null, size: 10 };
    const t = collection(parse(buildXml([bare])))[0];
    expect(t.getAttribute("Artist")).toBe("");
    expect(t.hasAttribute("TotalTime")).toBe(false);
    expect(t.hasAttribute("BitRate")).toBe(false);
    expect(t.hasAttribute("TrackNumber")).toBe(false);
    expect(t.getAttribute("Size")).toBe("10");
  });

  it("writes an empty but valid library", () => {
    const doc = parse(buildXml([], {}));
    expect(doc.querySelector("COLLECTION").getAttribute("Entries")).toBe("0");
    expect(doc.querySelector("PLAYLISTS NODE NODE").getAttribute("Entries")).toBe("0");
  });

  it("falls back to Needle for a blank playlist name", () => {
    const doc = parse(buildXml([track()], { playlistName: "   " }));
    expect(doc.querySelector("PLAYLISTS NODE NODE").getAttribute("Name")).toBe("Needle");
  });

  it("groups one playlist per job inside a folder when perRelease is on", () => {
    const lib = [
      track({ jobId: "j1", localPath: "/1", album: "First", artist: "X" }),
      track({ jobId: "j2", localPath: "/2", album: "Second", artist: null }),
      track({ jobId: "j1", localPath: "/3", album: "First", artist: "X" }),
      track({ jobId: "j3", localPath: "/4", album: null, title: "Loose" }),
      track({ jobId: "j4", localPath: "/5", album: "First", artist: "X" }),
    ];
    const doc = parse(buildXml(lib, { perRelease: true, playlistName: "Needle" }));
    const folder = doc.querySelector("PLAYLISTS > NODE > NODE");
    expect(folder.getAttribute("Type")).toBe("0");
    expect(folder.getAttribute("Name")).toBe("Needle");
    expect(folder.getAttribute("Count")).toBe("4");
    const lists = [...folder.querySelectorAll(":scope > NODE")];
    expect(lists.map((n) => n.getAttribute("Name"))).toEqual(["X - First", "Second", "Loose", "X - First (2)"]);
    expect(lists.map((n) => n.getAttribute("Entries"))).toEqual(["2", "1", "1", "1"]);
    expect([...lists[0].querySelectorAll("TRACK")].map((t) => t.getAttribute("Key"))).toEqual(["1", "3"]);
  });
});
