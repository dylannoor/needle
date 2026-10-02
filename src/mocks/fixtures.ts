// Realistic sample data for the mock backend. Mirrors the approved mockups.
import type { Buddy } from "../bindings/Buddy";
import type { BrowseResult } from "../bindings/BrowseResult";
import type { Candidate } from "../bindings/Candidate";
import type { ChatMessage } from "../bindings/ChatMessage";
import type { Codec } from "../bindings/Codec";
import type { ExtensionInfo } from "../bindings/ExtensionInfo";
import type { FileInfo } from "../bindings/FileInfo";
import type { Interests } from "../bindings/Interests";
import type { JobView } from "../bindings/JobView";
import type { QualityProfile } from "../bindings/QualityProfile";
import type { Recommendation } from "../bindings/Recommendation";
import type { Release } from "../bindings/Release";
import type { RoomSummary } from "../bindings/RoomSummary";
import type { RoomView } from "../bindings/RoomView";
import type { SearchView } from "../bindings/SearchView";
import type { SessionStatus } from "../bindings/SessionStatus";
import type { Settings } from "../bindings/Settings";
import type { SharesView } from "../bindings/SharesView";
import type { UploadsView } from "../bindings/UploadsView";
import type { UserProfile } from "../bindings/UserProfile";
import type { Verdict } from "../bindings/Verdict";
import type { WishItem } from "../bindings/WishItem";

export const NOW = Date.now();
const min = 60_000;
const MB = 1_000_000;

export const ME = "nightshift";

export const session = (): SessionStatus => ({
  state: "online",
  username: ME,
  error: null,
  listenPort: 2234,
  portOpen: true,
  away: false,
  remembered: true,
});

export const settings = (): Settings => ({
  downloadDir: "~/Music/Downloads",
  incompleteDir: "~/Music/Downloads/Incomplete",
  rejectedDir: "~/Music/Downloads/Rejected",
  listenPort: 2234,
  portMapping: true,
  uploadSlots: 3,
  uploadLimitKbps: 4000,
  downloadLimitKbps: 0,
  buddiesFirst: true,
  activeProfileId: "lossless-first",
  searchExclusions: ["live", "karaoke"],
  autoJoinRooms: ["Deep House", "Detroit Techno"],
  notifyPrivateMessages: true,
  notifyWishlistHits: true,
});

export const profiles = (): QualityProfile[] => [
  {
    id: "lossless-first",
    name: "Lossless first",
    tiers: [
      { label: "FLAC 24-bit", codecs: ["flac", "alac"], minBitDepth: 24, minSampleRate: null, minBitrateKbps: null, allowVbr: false },
      { label: "FLAC 16-bit", codecs: ["flac", "alac"], minBitDepth: 16, minSampleRate: 44100, minBitrateKbps: null, allowVbr: false },
      { label: "MP3 320 kbps", codecs: ["mp3"], minBitDepth: null, minSampleRate: null, minBitrateKbps: 320, allowVbr: true },
    ],
    maxQueue: 50,
    preferComplete: true,
    verify: { enabled: true, strictness: "normal", onFail: "delete" },
    stuck: { noDataSecs: 120, queueWaitSecs: 600, maxSources: 5, wishlistWhenExhausted: true },
  },
  {
    id: "dj-mp3",
    name: "DJ crate (MP3)",
    tiers: [
      { label: "MP3 320 kbps", codecs: ["mp3"], minBitDepth: null, minSampleRate: null, minBitrateKbps: 320, allowVbr: false },
      { label: "MP3 V0", codecs: ["mp3"], minBitDepth: null, minSampleRate: null, minBitrateKbps: 245, allowVbr: true },
    ],
    maxQueue: 20,
    preferComplete: false,
    verify: { enabled: true, strictness: "relaxed", onFail: "moveToRejected" },
    stuck: { noDataSecs: 60, queueWaitSecs: 300, maxSources: 8, wishlistWhenExhausted: false },
  },
];

const HOMEWORK = [
  "Daftendirekt", "WDPK 83.7 FM", "Revolution 909", "Da Funk", "Phœnix", "Fresh", "Around the World",
  "Rollin' & Scratchin'", "Teachers", "High Fidelity", "Rock'n Roll", "Oh Yeah", "Burnin'",
  "Indo Silver Club", "Alive", "Funk Ad",
];

const ext: Record<Codec, string> = {
  flac: "flac", alac: "m4a", wav: "wav", aiff: "aiff", mp3: "mp3", aac: "m4a", ogg: "ogg", opus: "opus", other: "jpg",
};

interface Fmt {
  codec: Codec;
  bitDepth?: number;
  sampleRate?: number;
  bitrate?: number;
  vbr?: boolean;
}

function files(folder: string, names: string[], fmt: Fmt, totalBytes: number, cover = true): FileInfo[] {
  const each = Math.round(totalBytes / names.length);
  const out: FileInfo[] = names.map((name, i) => ({
    path: `${folder}\\${String(i + 1).padStart(2, "0")} - ${name}.${ext[fmt.codec]}`,
    size: each + ((i * 7919) % 900_000),
    codec: fmt.codec,
    bitrateKbps: fmt.bitrate ?? (fmt.codec === "flac" ? 900 + ((i * 37) % 200) : null),
    vbr: fmt.vbr ?? (fmt.codec === "mp3" ? false : null),
    sampleRate: fmt.sampleRate ?? 44100,
    bitDepth: fmt.bitDepth ?? null,
    durationSecs: 180 + ((i * 53) % 240),
  }));
  if (cover) {
    out.push({ path: `${folder}\\cover.jpg`, size: 412_000, codec: "other", bitrateKbps: null, vbr: null, sampleRate: null, bitDepth: null, durationSecs: null });
  }
  return out;
}

function candidate(username: string, folder: string, fs: FileInfo[], freeSlot: boolean, avgSpeed: number, _queueLen: number | null): Candidate {
  return {
    id: `${username}|${folder}`,
    // soulseek-rs-lib does not report queue length yet.
    source: { username, freeSlot, avgSpeed, queueLen: null },
    folder,
    files: fs,
    totalSize: fs.reduce((a, f) => a + f.size, 0),
  };
}

interface RelSpec {
  user: string;
  title: string;
  label: string;
  fmt: Fmt;
  size: number;
  tracks: string[];
  free: boolean;
  speed: number;
  queue: number | null;
  tier: number;
  year?: number;
  expected?: number;
  alternates?: number;
}

function release(s: RelSpec, i: number, artist = "Daft Punk"): Release {
  const folder = `@@music\\${artist}\\${s.year ?? 1997} - ${s.title} [${s.label}]`;
  const best = candidate(s.user, folder, files(folder, s.tracks, s.fmt, s.size), s.free, s.speed, s.queue);
  const alternates = Array.from({ length: s.alternates ?? 0 }, (_, k) =>
    candidate(["vinyl_haus", "house_nation", "groove_cellar", "wax_poetic"][k % 4], folder, best.files, k % 2 === 0, 900_000 - k * 100_000, k * 2),
  );
  return {
    id: `r${i}`,
    title: s.title,
    artist,
    year: s.year ?? 1997,
    best,
    alternates,
    tier: s.tier,
    formatLabel: s.label,
    trackCount: s.tracks.length,
    expectedTracks: s.expected ?? s.tracks.length,
    score: 100 - i,
  };
}

const flac16: Fmt = { codec: "flac", bitDepth: 16, sampleRate: 44100 };

export function homeworkReleases(): Release[] {
  const specs: RelSpec[] = [
    { user: "deepcrates", title: "Homework", label: "FLAC 16/44.1", fmt: flac16, size: 482 * MB, tracks: HOMEWORK, free: true, speed: 2_100_000, queue: 0, tier: 1, alternates: 4 },
    { user: "kdj_archive", title: "Homework", label: "FLAC 24/96", fmt: { codec: "flac", bitDepth: 24, sampleRate: 96000 }, size: 1600 * MB, tracks: HOMEWORK, free: false, speed: 840_000, queue: 3, tier: 0, alternates: 1 },
    { user: "motorcity_wax", title: "Homework", label: "MP3 320", fmt: { codec: "mp3", bitrate: 320 }, size: 171 * MB, tracks: HOMEWORK, free: true, speed: 3_400_000, queue: 0, tier: 2, alternates: 2 },
    { user: "planet_e_fan", title: "Homework", label: "FLAC 16/44.1", fmt: flac16, size: 421 * MB, tracks: HOMEWORK.slice(0, 14), free: true, speed: 1_200_000, queue: 0, tier: 1, expected: 16 },
    { user: "soul_sounds", title: "Da Funk / Musique", label: "FLAC 16/44.1", fmt: flac16, size: 78 * MB, tracks: ["Da Funk", "Musique"], free: true, speed: 1_600_000, queue: 0, tier: 1 },
    { user: "lowend_theory", title: "Homework", label: "MP3 320", fmt: { codec: "mp3", bitrate: 320 }, size: 168 * MB, tracks: HOMEWORK, free: false, speed: 5_800_000, queue: 41, tier: 2 },
  ];
  return specs.map((s, i) => release(s, i));
}

export function homeworkHidden(): Release[] {
  const specs: RelSpec[] = [
    { user: "b_side_dave", title: "Homework", label: "MP3 192", fmt: { codec: "mp3", bitrate: 192 }, size: 110 * MB, tracks: HOMEWORK, free: true, speed: 900_000, queue: 0, tier: 3 },
    { user: "ravecave", title: "Homework", label: "MP3 128", fmt: { codec: "mp3", bitrate: 128 }, size: 74 * MB, tracks: HOMEWORK, free: true, speed: 400_000, queue: 0, tier: 3 },
    { user: "frenchtouch99", title: "Homework", label: "FLAC 16/44.1", fmt: flac16, size: 480 * MB, tracks: HOMEWORK, free: false, speed: 1_900_000, queue: 120, tier: 1 },
    { user: "itunes_rips", title: "Homework", label: "AAC 256", fmt: { codec: "aac", bitrate: 256 }, size: 140 * MB, tracks: HOMEWORK, free: true, speed: 700_000, queue: 2, tier: 3 },
  ];
  return specs.map((s, i) => release(s, 100 + i));
}

/** Generic results for any other query, so every search shows something. */
export function genericReleases(query: string): Release[] {
  const words = query.split(" ").filter(Boolean);
  const artist = words.length > 1 ? words.slice(0, Math.ceil(words.length / 2)).join(" ") : "Various Artists";
  const title = words.length > 1 ? words.slice(Math.ceil(words.length / 2)).join(" ") : query || "Untitled";
  const tracks = ["Intro", "Side A", "Night Drive", "Interlude", "Side B", "Outro"];
  const specs: RelSpec[] = [
    { user: "deepcrates", title, label: "FLAC 16/44.1", fmt: flac16, size: 240 * MB, tracks, free: true, speed: 1_800_000, queue: 0, tier: 1, alternates: 2, year: 2004 },
    { user: "groove_cellar", title, label: "MP3 320", fmt: { codec: "mp3", bitrate: 320 }, size: 92 * MB, tracks, free: true, speed: 2_400_000, queue: 0, tier: 2, year: 2004 },
    { user: "wax_poetic", title, label: "FLAC 24/48", fmt: { codec: "flac", bitDepth: 24, sampleRate: 48000 }, size: 520 * MB, tracks: tracks.slice(0, 5), free: false, speed: 600_000, queue: 6, tier: 0, expected: 6, year: 2004 },
  ];
  return specs.map((s, i) => release(s, 200 + i, artist));
}

export function searchView(searchId: string, query: string, done: boolean, includeHidden: boolean): SearchView {
  const homework = /daft|homework/i.test(query);
  const releases = homework ? homeworkReleases() : genericReleases(query);
  const shown = done ? releases : releases.slice(0, Math.ceil(releases.length / 2));
  return {
    searchId,
    query,
    releases: shown,
    hiddenReleases: includeHidden ? (homework ? homeworkHidden() : []) : [],
    hidden: homework
      ? { belowProfile: done ? 1102 : 540, queueTooLong: done ? 140 : 60, notAudio: done ? 36 : 12 }
      : { belowProfile: done ? 48 : 20, queueTooLong: 3, notAudio: 9 },
    totalFiles: homework ? 1284 : 72,
    totalPeers: homework ? 211 : 14,
    done,
  };
}

export const history = (): string[] => [
  "Daft Punk Homework",
  "Larry Heard Sceneries Not Songs",
  "Theo Parrish First Floor",
  "Robert Hood Minimal Nation",
  "Kerri Chandler Trax on da Rocks",
  "Moodymann Silentintroduction",
];

/** 64 bands of a CD-quality spectrum that falls off a cliff at `cutoffHz`. */
export function spectrum(cutoffHz: number | null, nyquistHz = 22050): number[] {
  return Array.from({ length: 64 }, (_, i) => {
    const hz = ((i + 0.5) / 64) * nyquistHz;
    if (cutoffHz !== null && hz > cutoffHz) return -112 + (i % 2) * 3;
    return Math.round(-18 - (hz / nyquistHz) * 46 - (i % 3) * 2.5);
  });
}

const rejected: Verdict = {
  ok: false,
  codec: "flac",
  sampleRate: 44100,
  bitDepth: 16,
  bitrateKbps: 712,
  cutoffHz: 16000,
  nyquistHz: 22050,
  reason: "CD audio reaches about 22 kHz. This file stops at 16 kHz, the signature of a 128 to 192 kbps MP3 saved as FLAC.",
  spectrum: spectrum(16000),
};

const verified = (codec: Codec = "flac"): Verdict => ({
  ok: true,
  codec,
  sampleRate: 44100,
  bitDepth: codec === "flac" ? 16 : null,
  bitrateKbps: codec === "flac" ? 940 : 320,
  cutoffHz: codec === "flac" ? null : 20000,
  nyquistHz: 22050,
  reason: null,
  spectrum: spectrum(codec === "flac" ? null : 20000),
});

function items(names: string[], codec: Codec, done: number, active: number, size: number): JobView["items"] {
  return names.map((n, i) => {
    const name = `${String(i + 1).padStart(2, "0")} - ${n}.${ext[codec]}`;
    if (i < done) return { name, size, bytes: size, state: { kind: "verified" }, localPath: `~/Music/Downloads/${name}`, verdict: verified(codec) };
    if (i < done + active) return { name, size, bytes: Math.round(size * 0.4), state: { kind: "downloading" }, localPath: null, verdict: null };
    return { name, size, bytes: 0, state: { kind: "pending" }, localPath: null, verdict: null };
  });
}

export function jobs(): JobView[] {
  const larry = ["Can You Feel It", "Mystery of Love", "Washing Machine", "Beyond the Clouds", "Gods of the Sun", "The Juice", "Distant Planet", "Lifes Ride"];
  const larryItems = items(larry, "flac", 5, 0, 38 * MB);
  larryItems[2] = { name: "03 - Washing Machine.flac", size: 38 * MB, bytes: 38 * MB, state: { kind: "rejected" }, localPath: null, verdict: rejected };
  larryItems[5] = { ...larryItems[5], state: { kind: "downloading" }, bytes: 12 * MB };
  const theo = ["Summertime Is Here", "Moonlight Music", "Dance of the Drunken Saint", "Ballet", "Electric Sax", "Smoke"];
  return [
    {
      id: "j1", title: "Homework", artist: "Daft Punk", formatLabel: "FLAC 16/44.1",
      status: { kind: "downloading" }, detail: "from deepcrates", currentUser: "deepcrates", sourceIndex: 1, sourceCount: 5,
      items: items(HOMEWORK, "flac", 9, 1, 30 * MB), bytes: 299 * MB, total: 482 * MB, speed: 1_900_000, switchInSecs: null,
      log: [
        { atMs: NOW - 6 * min, text: "Picked deepcrates: FLAC 16/44.1, free slot, 4 identical sources as backup", tone: "info" },
        { atMs: NOW - 2 * min, text: "01 to 09 passed the lossless check", tone: "ok" },
      ],
      outputDir: "~/Music/Downloads/1997 - Homework [FLAC]", createdMs: NOW - 1 * min, finishedMs: null,
    },
    {
      id: "j2", title: "Sceneries Not Songs, Volume One", artist: "Larry Heard", formatLabel: "FLAC 16/44.1",
      status: { kind: "recovering", reason: "Replacing 03 - Washing Machine.flac" }, detail: "failed the lossless check", currentUser: "house_nation",
      sourceIndex: 2, sourceCount: 5, items: larryItems, bytes: 246 * MB, total: 304 * MB, speed: 1_100_000, switchInSecs: null,
      log: [
        { atMs: NOW - 9 * min, text: "kdj_archive stopped sending data, switched to vinyl_haus", tone: "warn" },
        { atMs: NOW - 6 * min, text: "03 - Washing Machine.flac failed the check and was deleted", tone: "warn" },
        { atMs: NOW - 6 * min, text: "Found the same file at house_nation, downloading", tone: "info" },
      ],
      outputDir: "~/Music/Downloads/Larry Heard - Sceneries Not Songs", createdMs: NOW - 3 * min, finishedMs: null,
    },
    {
      id: "j3", title: "First Floor", artist: "Theo Parrish", formatLabel: "FLAC 16/44.1",
      status: { kind: "downloading" }, detail: "kdj_archive stopped sending, now soul_sounds", currentUser: "soul_sounds",
      sourceIndex: 2, sourceCount: 3, items: items(theo, "flac", 2, 1, 40 * MB), bytes: 82 * MB, total: 240 * MB, speed: 1_200_000, switchInSecs: null,
      log: [{ atMs: NOW - 3 * min, text: "kdj_archive stopped sending data, switched to soul_sounds", tone: "warn" }],
      outputDir: "~/Music/Downloads/Theo Parrish - First Floor", createdMs: NOW - 5 * min, finishedMs: null,
    },
    {
      id: "j4", title: "Minimal Nation", artist: "Robert Hood", formatLabel: "MP3 320",
      status: { kind: "queued", position: null }, detail: "at hood_fan", currentUser: "hood_fan",
      sourceIndex: 1, sourceCount: 2, items: items(["The Pace", "Rhythm of Vision", "Minimal Nation", "Ride Out", "Unix", "Self Powered"], "mp3", 0, 0, 14 * MB),
      bytes: 0, total: 84 * MB, speed: 0, switchInSecs: 460,
      log: [{ atMs: NOW - 2 * min, text: "Waiting in hood_fan's queue", tone: "info" }],
      outputDir: "~/Music/Downloads/Robert Hood - Minimal Nation", createdMs: NOW - 8 * min, finishedMs: null,
    },
    {
      id: "j5", title: "Trax on da Rocks", artist: "Kerri Chandler", formatLabel: "FLAC 16/44.1",
      status: { kind: "done" }, detail: "All files verified lossless", currentUser: "b_side_dave",
      sourceIndex: 1, sourceCount: 2, items: items(["Track 1", "Track 2", "Track 3", "Track 4"], "flac", 4, 0, 45 * MB),
      bytes: 180 * MB, total: 180 * MB, speed: 0, switchInSecs: null,
      log: [{ atMs: NOW - 70 * min, text: "All 4 files passed the lossless check", tone: "ok" }],
      outputDir: "~/Music/Downloads/Kerri Chandler - Trax on da Rocks", createdMs: NOW - 90 * min, finishedMs: NOW - 70 * min,
    },
    {
      id: "j6", title: "Silentintroduction", artist: "Moodymann", formatLabel: "MP3 320",
      status: { kind: "done" }, detail: "Verified MP3 320", currentUser: "motorcity_wax",
      sourceIndex: 1, sourceCount: 1, items: items(["Don't Be Afraid", "Misled", "Me and Her", "Tribute"], "mp3", 4, 0, 13 * MB),
      bytes: 52 * MB, total: 52 * MB, speed: 0, switchInSecs: null,
      log: [{ atMs: NOW - 130 * min, text: "All 4 files passed the MP3 320 check", tone: "ok" }],
      outputDir: "~/Music/Downloads/Moodymann - Silentintroduction", createdMs: NOW - 140 * min, finishedMs: NOW - 130 * min,
    },
  ];
}

export const uploads = (): UploadsView => ({
  slots: 3,
  slotsUsed: 2,
  waiting: 5,
  uploads: [
    { username: "lowend_theory", path: "Library/Robert Hood/Minimal Nation/04.flac", size: 41 * MB, bytes: 19.7 * MB, speed: 640_000, state: { kind: "uploading" }, buddy: false },
    { username: "b_side_dave", path: "Rips/Kerri Chandler - Trax on da Rocks/01.flac", size: 44 * MB, bytes: 5.3 * MB, speed: 480_000, state: { kind: "uploading" }, buddy: true },
    { username: "frenchtouch99", path: "Library/Daft Punk/Homework/07.flac", size: 39 * MB, bytes: 0, speed: 0, state: { kind: "queued", position: 1 }, buddy: false },
    { username: "ravecave", path: "Library/Moodymann/Forevernevermore/02.flac", size: 52 * MB, bytes: 0, speed: 0, state: { kind: "queued", position: 2 }, buddy: false },
    { username: "groove_cellar", path: "Promos/Unreleased/dub.wav", size: 61 * MB, bytes: 61 * MB, speed: 0, state: { kind: "done" }, buddy: true },
  ],
});

export const shares = (): SharesView => ({
  folders: [
    { path: "~/Music/Library", visibility: "everyone", files: 18402, bytes: 642e9, status: { kind: "scanned", at_ms: NOW - 2 * min } },
    { path: "~/Music/Rips", visibility: "everyone", files: 1204, bytes: 88e9, status: { kind: "scanning", percent: 64 } },
    { path: "~/Music/Promos", visibility: "buddies", files: 312, bytes: 9.4e9, status: { kind: "notShared" } },
    { path: "~/Music/Library/Private", visibility: "nobody", files: 233, bytes: 7.1e9, status: { kind: "notShared" } },
  ],
  sharedFiles: 19606,
  sharedFolders: 1712,
  ownedFiles: 18402,
  unreadable: Array.from({ length: 37 }, (_, i) => `~/Music/Library/Unsorted/damaged_${String(i + 1).padStart(2, "0")}.flac`),
});

export const buddies = (): Buddy[] => [
  { username: "deepcrates", presence: "online", note: "Best Chicago house rips", lastSeenMs: null, files: 48210 },
  { username: "b_side_dave", presence: "online", note: "", lastSeenMs: null, files: 12034 },
  { username: "vinyl_haus", presence: "away", note: "Vinyl only, ask before big folders", lastSeenMs: null, files: 8800 },
  { username: "kdj_archive", presence: "offline", note: "", lastSeenMs: NOW - 26 * 60 * min, files: 91233 },
  { username: "soul_sounds", presence: "online", note: "Detroit stuff", lastSeenMs: null, files: 23111 },
];

export const blocked = () => ({ banned: ["leech_master"], ignored: ["spam_bot_42", "capslock_carl"] });

export const rooms = (): RoomSummary[] => [
  { name: "Deep House", users: 412, private: false, joined: true },
  { name: "Detroit Techno", users: 288, private: false, joined: true },
  { name: "Chicago House", users: 196, private: false, joined: false },
  { name: "Jazz", users: 341, private: false, joined: false },
  { name: "Lossless Only", users: 158, private: false, joined: false },
  { name: "Ambient", users: 133, private: false, joined: false },
  { name: "Dub Techno", users: 97, private: false, joined: false },
  { name: "Crate Diggers", users: 12, private: true, joined: false },
  { name: "Italo Disco", users: 74, private: false, joined: false },
  { name: "Drum and Bass", users: 265, private: false, joined: false },
];

const msg = (channel: string, username: string, text: string, ago: number, own = false): ChatMessage => ({
  channel, username, text, atMs: NOW - ago * min, own, action: false,
});

export function roomView(name: string): RoomView {
  const people = ["deepcrates", "soul_sounds", "vinyl_haus", "groove_cellar", "planet_e_fan", "kdj_archive", "wax_poetic", ME];
  const lines: Record<string, ChatMessage[]> = {
    "Deep House": [
      msg(name, "groove_cellar", "anyone got the Kerri Chandler Atmosphere EP in lossless?", 22),
      msg(name, "deepcrates", "yes, in my shares under Chandler/Atmosphere", 21),
      msg(name, "groove_cellar", "legend, thanks", 20),
      msg(name, "vinyl_haus", "just ripped a clean copy of Larry Heard Alien, 24/96", 9),
      msg(name, ME, "nice, queued it", 8, true),
      msg(name, "soul_sounds", "Moodymann set tonight on the stream, 10pm CET", 2),
    ],
  };
  return {
    name,
    members: people.map((u, i) => ({
      username: u,
      presence: i === 2 ? "away" : "online",
      files: 4000 + i * 3133,
      avgSpeed: 400_000 + i * 210_000,
      operator: i === 0,
    })),
    messages: lines[name] ?? [msg(name, "soul_sounds", `Welcome to ${name}`, 30), msg(name, "wax_poetic", "evening all", 5)],
    tickers: [["deepcrates", "Sharing 48k files of Chicago house, buddies first"], ["soul_sounds", "Moodymann set tonight 10pm CET"]],
    private: rooms().find((r) => r.name === name)?.private ?? false,
    owner: null,
  };
}

export const conversations = (): Record<string, { unread: number; presence: Buddy["presence"]; messages: ChatMessage[] }> => ({
  deepcrates: {
    unread: 1,
    presence: "online",
    messages: [
      msg("deepcrates", ME, "Hey, is the Homework rip from the original CD?", 40, true),
      msg("deepcrates", "deepcrates", "Yes, 1997 Virgin pressing, ripped with EAC", 38),
      msg("deepcrates", "deepcrates", "Log file is in the folder if you want to check", 3),
    ],
  },
  vinyl_haus: {
    unread: 1,
    presence: "away",
    messages: [msg("vinyl_haus", "vinyl_haus", "Thanks for the Theo Parrish, I owe you one", 15)],
  },
  b_side_dave: {
    unread: 0,
    presence: "online",
    messages: [
      msg("b_side_dave", "b_side_dave", "Your upload slot is free if you want the Chandler", 200),
      msg("b_side_dave", ME, "grabbing it now, cheers", 190, true),
    ],
  },
});

export function userProfile(username: string, buddy: boolean, banned: boolean, ignored: boolean): UserProfile {
  const h = [...username].reduce((a, c) => a + c.charCodeAt(0), 0);
  return {
    username,
    presence: h % 5 === 0 ? "away" : "online",
    avgSpeed: 300_000 + (h % 20) * 150_000,
    files: 2000 + (h * 97) % 60000,
    folders: 120 + (h * 13) % 4000,
    freeSlot: h % 3 !== 0,
    queueLen: h % 3 === 0 ? h % 30 : 0,
    description:
      username === "deepcrates"
        ? "Chicago and Detroit house from the original records. Everything ripped myself, logs included. Buddies get first slots."
        : "Music lover. Please don't queue whole discographies at once.",
    picture: null,
    likes: ["Chicago house", "Larry Heard", "Detroit techno", "Jazz funk"],
    dislikes: ["EDM", "Radio edits"],
    buddy,
    banned,
    ignored,
  };
}

export function browse(username: string): BrowseResult {
  const root = `@@music`;
  const mk = (folder: string, names: string[], fmt: Fmt, size: number) => ({ path: `${root}\\${folder}`, files: files(`${root}\\${folder}`, names, fmt, size) });
  return {
    username,
    dirs: [
      mk("Chicago\\Larry Heard\\1988 - Amnesia", ["Can You Feel It", "Washing Machine", "Mystery of Love", "Beyond the Clouds"], flac16, 160 * MB),
      mk("Chicago\\Larry Heard\\1989 - Another Side", ["Another Side", "Lifes Ride", "The Juice"], flac16, 120 * MB),
      mk("Chicago\\Frankie Knuckles\\1987 - Your Love", ["Your Love", "Baby Wants to Ride"], flac16, 80 * MB),
      mk("Detroit\\Robert Hood\\1994 - Minimal Nation", ["The Pace", "Rhythm of Vision", "Minimal Nation", "Ride Out"], { codec: "mp3", bitrate: 320 }, 50 * MB),
      mk("Detroit\\Moodymann\\1997 - Silentintroduction", ["Don't Be Afraid", "Misled", "Tribute"], flac16, 140 * MB),
      mk("Daft Punk\\1997 - Homework", HOMEWORK, flac16, 482 * MB),
    ],
    lockedDirs: [],
    error: null,
  };
}

export const interests = (): Interests => ({
  likes: ["Chicago house", "Deep house", "Detroit techno", "Larry Heard"],
  dislikes: ["Big room", "Dubstep"],
});

export const recommendations = (global: boolean): Recommendation[] =>
  global
    ? [
        { item: "Electronic", score: 912 }, { item: "Jazz", score: 640 }, { item: "Ambient", score: 488 },
        { item: "Hip hop", score: 455 }, { item: "Soul", score: 390 },
      ]
    : [
        { item: "Ron Trent", score: 42 }, { item: "Theo Parrish", score: 38 }, { item: "Kerri Chandler", score: 31 },
        { item: "Moodymann", score: 29 }, { item: "Lil Louis", score: 17 }, { item: "Jazz funk", score: 12 },
      ];

export const similarUsers = () => ["deepcrates", "house_nation", "groove_cellar", "planet_e_fan", "wax_poetic"];

export const wishlist = (): WishItem[] => [
  { query: "Larry Heard Alien 24/96", addedMs: NOW - 5 * 24 * 60 * min, lastRunMs: NOW - 40 * min, matches: 2, searchId: "wish-1" },
  { query: "Theo Parrish Sound Signature Sounds", addedMs: NOW - 2 * 24 * 60 * min, lastRunMs: NOW - 40 * min, matches: 0, searchId: null },
  { query: "Ron Trent Primitive Arts", addedMs: NOW - 60 * min, lastRunMs: null, matches: 0, searchId: null },
];

export const extensions = (): ExtensionInfo[] => [
  {
    manifest: {
      id: "rekordbox",
      name: "Rekordbox",
      version: "0.1.0",
      description: "Keeps a Needle playlist in rekordbox.xml with every verified download, ready to import in Rekordbox.",
      author: "Needle",
      main: "worker.js",
      panel: "panel.html",
      permissions: ["events:download.verified", "fs:read:~/Music/rekordbox", "fs:write:~/Music/rekordbox", "notify"],
    },
    enabled: true,
    dir: "/Applications/Needle.app/Contents/Resources/extensions/rekordbox",
    error: null,
    builtin: true,
  },
  {
    manifest: {
      id: "lastfm",
      name: "Last.fm loved tracks",
      version: "0.3.2",
      description: "Adds your loved tracks on Last.fm to the wishlist.",
      author: "community",
      main: "worker.js",
      panel: null,
      permissions: ["jobs:read", "events:search.completed"],
    },
    enabled: false,
    dir: "~/Library/Application Support/needle/extensions/lastfm",
    error: null,
    builtin: false,
  },
];
