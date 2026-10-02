// In-memory stand-in for the Rust backend, used when the app runs outside
// Tauri (pnpm dev in a browser, Vitest). Implements every command in
// docs/ipc.md against the fixtures and emits the same events.
import type { Args } from "../lib/ipc";
import type { ChatMessage } from "../bindings/ChatMessage";
import type { FileInfo } from "../bindings/FileInfo";
import type { JobView } from "../bindings/JobView";
import type { QualityProfile } from "../bindings/QualityProfile";
import type { Settings } from "../bindings/Settings";
import type { Visibility } from "../bindings/Visibility";
import * as fx from "./fixtures";
import { baseName, isAudio } from "../lib/format";

type Handler = (args: Args) => unknown;
type Listener = (payload: unknown) => void;

function createState() {
  const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  return {
    session: params.has("login") ? { ...fx.session(), state: "offline" as const, username: null } : fx.session(),
    settings: fx.settings(),
    profiles: fx.profiles(),
    history: fx.history(),
    searches: new Map<string, { query: string; done: boolean }>([["wish-1", { query: "Larry Heard Alien 24/96", done: true }]]),
    jobs: fx.jobs(),
    uploads: fx.uploads(),
    shares: fx.shares(),
    buddies: fx.buddies(),
    blocked: fx.blocked(),
    rooms: fx.rooms(),
    roomViews: new Map(fx.rooms().filter((r) => r.joined).map((r) => [r.name, fx.roomView(r.name)])),
    convos: fx.conversations(),
    interests: fx.interests(),
    wishlist: fx.wishlist(),
    extensions: fx.extensions(),
    lastSearch: null as string | null,
    seq: 0,
  };
}

export function createMockBackend(opts: { latency?: number; simulate?: boolean } = {}) {
  let s = createState();
  const listeners = new Map<string, Set<Listener>>();
  const latency = opts.latency ?? 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const emit = (name: string, payload: unknown) => listeners.get(name)?.forEach((cb) => cb(structuredClone(payload)));
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };
  const str = (a: Args, k: string) => String(a[k] ?? "");
  const job = (id: string) => {
    const j = s.jobs.find((x) => x.id === id);
    if (!j) throw "That download no longer exists.";
    return j;
  };
  const updateJob = (j: JobView) => {
    emit("jobs:update", j);
    return j;
  };
  const finished = (j: JobView) => ["done", "failed", "cancelled"].includes(j.status.kind);
  const user = (a: Args) => {
    const u = str(a, "username").trim();
    if (!u) throw "Enter a username.";
    return u;
  };

  const makeJob = (title: string, artist: string | null, formatLabel: string, owner: string, fs: FileInfo[], sources: number): JobView => {
    const audio = fs.filter(isAudio);
    return {
      id: `j${++s.seq + 100}`,
      title,
      artist,
      formatLabel,
      status: { kind: "waiting" },
      detail: `asking ${owner}`,
      currentUser: owner,
      sourceIndex: 1,
      sourceCount: sources,
      items: audio.map((f) => ({ name: baseName(f.path), size: f.size, bytes: 0, state: { kind: "pending" }, localPath: null, verdict: null })),
      bytes: 0,
      total: audio.reduce((a, f) => a + f.size, 0),
      speed: 0,
      switchInSecs: null,
      log: [{ atMs: Date.now(), text: `Picked ${owner}, ${sources > 1 ? `${sources - 1} identical sources as backup` : "no backup sources"}`, tone: "info" }],
      outputDir: `${s.settings.downloadDir}/${title}`,
      createdMs: Date.now(),
      finishedMs: null,
    };
  };

  const handlers: Record<string, Handler> = {
    session_status: () => s.session,
    login: (a) => {
      const username = str(a, "username").trim();
      if (!username || !str(a, "password")) throw "Enter your username and password.";
      // Like the real backend: answer "connecting" now, report the outcome as a session event.
      const wrong = str(a, "password") === "wrong";
      s.session = { ...s.session, state: "connecting", username, error: null, remembered: Boolean(a.remember) };
      later(latency * 4, () => {
        s.session = wrong
          ? { ...s.session, state: "error", error: "That password doesn't match this username. Soulseek usernames are claimed by whoever logs in first." }
          : { ...s.session, state: "online" };
        emit("session", s.session);
      });
      return s.session;
    },
    logout: () => {
      s.session = { ...s.session, state: "offline", username: null, remembered: false };
      emit("session", s.session);
      return s.session;
    },
    set_away: (a) => {
      s.session = { ...s.session, away: Boolean(a.away) };
      emit("session", s.session);
      return s.session;
    },

    search_start: (a) => {
      const query = str(a, "query").trim();
      if (!query) throw "Type something to search for.";
      const id = `s${++s.seq}`;
      s.searches.set(id, { query, done: false });
      s.history = [query, ...s.history.filter((h) => h !== query)].slice(0, 50);
      s.lastSearch = id;
      later(250, () => emit("search:update", fx.searchView(id, query, false, false)));
      later(900, () => {
        const e = s.searches.get(id);
        if (e) e.done = true;
        emit("search:update", fx.searchView(id, query, true, false));
      });
      return id;
    },
    search_user: (a) => handlers.search_start({ query: `${str(a, "query")}` }),
    search_room: (a) => handlers.search_start({ query: `${str(a, "query")}` }),
    search_view: (a) => {
      const e = s.searches.get(str(a, "searchId"));
      if (!e) throw "That search has expired, run it again";
      return fx.searchView(str(a, "searchId"), e.query, e.done, Boolean(a.includeHidden));
    },
    search_cancel: (a) => {
      const e = s.searches.get(str(a, "searchId"));
      if (e) e.done = true;
      return null;
    },
    search_history: () => s.history,

    download_release: (a) => {
      const e = s.searches.get(str(a, "searchId"));
      if (!e) throw "That search has expired, run it again";
      const view = fx.searchView(str(a, "searchId"), e.query, true, true);
      const r = [...view.releases, ...view.hiddenReleases].find((x) => x.id === str(a, "releaseId"));
      if (!r) throw "That release is no longer in the results.";
      const pick = a.files as string[] | null;
      const fs = pick ? r.best.files.filter((f) => pick.includes(f.path)) : r.best.files;
      const j = makeJob(r.title, r.artist, r.formatLabel, r.best.source.username, fs, r.alternates.length + 1);
      s.jobs = [j, ...s.jobs];
      return updateJob(j);
    },
    download_files: (a) => {
      const fs = a.files as FileInfo[];
      if (!fs?.length) throw "Pick at least one file.";
      const j = makeJob(baseName(str(a, "folder")), null, fs[0].codec.toUpperCase(), user(a), fs, 1);
      s.jobs = [j, ...s.jobs];
      return updateJob(j);
    },
    jobs_list: () => [...s.jobs].sort((x, y) => Number(finished(x)) - Number(finished(y)) || y.createdMs - x.createdMs),
    job_pause: (a) => {
      const j = job(str(a, "jobId"));
      j.status = { kind: "paused" };
      j.speed = 0;
      j.detail = "paused by you";
      return updateJob(j);
    },
    job_resume: (a) => {
      const j = job(str(a, "jobId"));
      j.status = { kind: "downloading" };
      j.detail = j.currentUser ? `from ${j.currentUser}` : "";
      return updateJob(j);
    },
    job_cancel: (a) => {
      const j = job(str(a, "jobId"));
      j.status = { kind: "cancelled" };
      j.speed = 0;
      j.detail = "cancelled by you";
      j.finishedMs = Date.now();
      return updateJob(j);
    },
    job_retry: (a) => {
      const j = job(str(a, "jobId"));
      j.status = { kind: "waiting" };
      j.finishedMs = null;
      j.detail = "trying again";
      return updateJob(j);
    },
    job_remove: (a) => {
      s.jobs = s.jobs.filter((j) => j.id !== str(a, "jobId"));
      return null;
    },
    jobs_clear_finished: () => {
      s.jobs = s.jobs.filter((j) => !finished(j));
      return null;
    },
    job_keep_file: (a) => {
      const j = job(str(a, "jobId"));
      const it = j.items.find((i) => i.name === str(a, "name"));
      if (!it) throw "That file is not part of this download.";
      it.state = { kind: "keptAnyway" };
      it.localPath = `${j.outputDir}/${it.name}`;
      j.log = [...j.log, { atMs: Date.now(), text: `Kept ${it.name} although it failed the check`, tone: "warn" }];
      return updateJob(j);
    },
    job_reveal: () => null,

    uploads_view: () => s.uploads,
    upload_cancel: (a) => {
      s.uploads = { ...s.uploads, uploads: s.uploads.uploads.filter((u) => !(u.username === str(a, "username") && u.path === str(a, "path"))) };
      emit("uploads:update", s.uploads);
      return null;
    },

    shares_view: () => s.shares,
    share_add: (a) => {
      const path = str(a, "path");
      if (s.shares.folders.some((f) => f.path === path)) throw "That folder is already shared.";
      s.shares = {
        ...s.shares,
        folders: [...s.shares.folders, { path, visibility: a.visibility as Visibility, files: 0, bytes: 0, status: { kind: "scanning", percent: 0 } }],
      };
      return s.shares;
    },
    share_remove: (a) => {
      s.shares = { ...s.shares, folders: s.shares.folders.filter((f) => f.path !== str(a, "path")) };
      return s.shares;
    },
    share_set_visibility: (a) => {
      const visibility = a.visibility as Visibility;
      s.shares = {
        ...s.shares,
        folders: s.shares.folders.map((f) =>
          f.path === str(a, "path")
            ? { ...f, visibility, status: visibility !== "everyone" ? { kind: "notShared" } : f.status.kind === "notShared" ? { kind: "scanned", atMs: Date.now() } : f.status }
            : f,
        ),
      };
      return s.shares;
    },
    shares_rescan: () => {
      s.shares = {
        ...s.shares,
        folders: s.shares.folders.map((f) => (f.visibility !== "everyone" ? f : { ...f, status: { kind: "scanning", percent: 0 } })),
      };
      later(1500, () => {
        s.shares = {
          ...s.shares,
          folders: s.shares.folders.map((f) => (f.status.kind === "scanning" ? { ...f, status: { kind: "scanned", atMs: Date.now() } } : f)),
        };
        emit("shares:update", s.shares);
      });
      return s.shares;
    },
    pick_folder: () => {
      const p = typeof window !== "undefined" && typeof window.prompt === "function" ? window.prompt("Folder path (mock folder picker)", "~/Music/New folder") : null;
      return p || null;
    },
    owned_check: (a) => (a.files as { path: string; size: number }[]).map((f) => /Homework \[FLAC 24|Da Funk \/ Musique/.test(f.path)),

    settings_get: () => s.settings,
    settings_set: (a) => {
      s.settings = a.settings as Settings;
      return s.settings;
    },
    profiles_list: () => s.profiles,
    profile_save: (a) => {
      const sent = a.profile as QualityProfile;
      // Like the backend: builtin comes from the stored profile, never from the client.
      const p = { ...sent, builtin: s.profiles.find((x) => x.id === sent.id)?.builtin ?? false };
      if (!p.name.trim()) throw "Give the profile a name.";
      if (!p.tiers.length) throw "A profile needs at least one tier.";
      const i = s.profiles.findIndex((x) => x.id === p.id);
      s.profiles = i < 0 ? [...s.profiles, p] : s.profiles.map((x) => (x.id === p.id ? p : x));
      return s.profiles;
    },
    profile_delete: (a) => {
      if (s.profiles.find((p) => p.id === str(a, "id"))?.builtin) throw "The built-in profile can't be deleted.";
      s.profiles = s.profiles.filter((p) => p.id !== str(a, "id"));
      return s.profiles;
    },
    profile_preview: (a) => {
      if (!s.lastSearch && !s.searches.size) return null;
      const p = a.profile as QualityProfile;
      const shown = Math.max(0, Math.min(1284, p.tiers.length * 2 + (p.maxQueue >= 41 ? 1 : 0) - (p.preferComplete ? 1 : 0)));
      return [shown, 1284];
    },

    user_profile: (a) => {
      const u = user(a);
      return fx.userProfile(u, s.buddies.some((b) => b.username === u), s.blocked.banned.includes(u), s.blocked.ignored.includes(u));
    },
    buddies_list: () => s.buddies,
    buddy_add: (a) => {
      const u = user(a);
      if (!s.buddies.some((b) => b.username === u)) s.buddies = [...s.buddies, { username: u, presence: "online", note: "", lastSeenMs: null, files: null }];
      emit("buddies:update", s.buddies);
      return s.buddies;
    },
    buddy_remove: (a) => {
      s.buddies = s.buddies.filter((b) => b.username !== str(a, "username"));
      emit("buddies:update", s.buddies);
      return s.buddies;
    },
    buddy_note: (a) => {
      s.buddies = s.buddies.map((b) => (b.username === str(a, "username") ? { ...b, note: str(a, "note") } : b));
      return s.buddies;
    },
    user_ban: (a) => {
      s.blocked.banned = [...new Set([...s.blocked.banned, user(a)])];
      return null;
    },
    user_unban: (a) => {
      s.blocked.banned = s.blocked.banned.filter((u) => u !== str(a, "username"));
      return null;
    },
    user_ignore: (a) => {
      s.blocked.ignored = [...new Set([...s.blocked.ignored, user(a)])];
      return null;
    },
    user_unignore: (a) => {
      s.blocked.ignored = s.blocked.ignored.filter((u) => u !== str(a, "username"));
      return null;
    },
    blocked_list: () => s.blocked,
    browse_user: (a) => fx.browse(user(a)),

    rooms_list: () => s.rooms,
    room_join: (a) => {
      const room = str(a, "room").trim();
      if (!room) throw "Enter a room name.";
      if (!s.rooms.some((r) => r.name === room)) s.rooms = [...s.rooms, { name: room, users: 1, private: false, joined: true }];
      s.rooms = s.rooms.map((r) => (r.name === room ? { ...r, joined: true } : r));
      const v = s.roomViews.get(room) ?? fx.roomView(room);
      s.roomViews.set(room, v);
      emit("room:event", { kind: "listChanged" });
      return v;
    },
    room_leave: (a) => {
      s.rooms = s.rooms.map((r) => (r.name === str(a, "room") ? { ...r, joined: false } : r));
      s.roomViews.delete(str(a, "room"));
      emit("room:event", { kind: "listChanged" });
      return null;
    },
    room_view: (a) => {
      const v = s.roomViews.get(str(a, "room"));
      if (!v) throw "You're not in that room.";
      return v;
    },
    room_say: (a) => {
      const v = s.roomViews.get(str(a, "room"));
      if (!v) throw "You're not in that room.";
      const message: ChatMessage = { channel: v.name, username: s.session.username ?? fx.ME, text: str(a, "text"), atMs: Date.now(), own: true, action: false };
      v.messages = [...v.messages, message];
      emit("room:event", { kind: "message", message });
      return null;
    },
    room_set_ticker: (a) => {
      const v = s.roomViews.get(str(a, "room"));
      if (!v) throw "You're not in that room.";
      const me = s.session.username ?? fx.ME;
      v.tickers = [...v.tickers.filter(([u]) => u !== me), [me, str(a, "text")]];
      emit("room:event", { kind: "ticker", room: v.name, username: me, text: str(a, "text") });
      return null;
    },
    conversations_list: () =>
      Object.entries(s.convos)
        .map(([username, c]) => ({ username, last: c.messages.at(-1) ?? null, unread: c.unread, presence: c.presence }))
        .sort((x, y) => (y.last?.atMs ?? 0) - (x.last?.atMs ?? 0)),
    conversation: (a) => s.convos[str(a, "username")]?.messages ?? [],
    pm_send: (a) => {
      const u = user(a);
      const text = str(a, "text").trim();
      if (!text) throw "Type a message first.";
      const m: ChatMessage = { channel: u, username: s.session.username ?? fx.ME, text, atMs: Date.now(), own: true, action: false };
      const c = (s.convos[u] ??= { unread: 0, presence: "online", messages: [] });
      c.messages = [...c.messages, m];
      if (opts.simulate) {
        later(2500, () => {
          const reply: ChatMessage = { channel: u, username: u, text: "Sure, go ahead.", atMs: Date.now(), own: false, action: false };
          c.messages = [...c.messages, reply];
          c.unread += 1;
          emit("pm:message", reply);
        });
      }
      return m;
    },
    pm_mark_read: (a) => {
      const c = s.convos[str(a, "username")];
      if (c) c.unread = 0;
      return null;
    },

    interests_get: () => s.interests,
    interest_add: (a) => {
      const item = str(a, "item").trim();
      if (!item) throw "Type an interest first.";
      const key = a.like ? "likes" : "dislikes";
      s.interests = { ...s.interests, [key]: [...new Set([...s.interests[key], item])] };
      return s.interests;
    },
    interest_remove: (a) => {
      const key = a.like ? "likes" : "dislikes";
      s.interests = { ...s.interests, [key]: s.interests[key].filter((i) => i !== str(a, "item")) };
      return s.interests;
    },
    recommendations: (a) => fx.recommendations(Boolean(a.global)),
    similar_users: () => fx.similarUsers(),
    wishlist_list: () => s.wishlist,
    wishlist_add: (a) => {
      const query = str(a, "query").trim();
      if (!query) throw "Type what you're looking for.";
      if (!s.wishlist.some((w) => w.query === query)) s.wishlist = [...s.wishlist, { query, addedMs: Date.now(), lastRunMs: null, matches: 0, searchId: null }];
      return s.wishlist;
    },
    wishlist_remove: (a) => {
      s.wishlist = s.wishlist.filter((w) => w.query !== str(a, "query"));
      return s.wishlist;
    },

    extensions_list: () => s.extensions,
    extension_set_enabled: (a) => {
      s.extensions = s.extensions.map((e) => (e.manifest.id === str(a, "id") ? { ...e, enabled: Boolean(a.enabled) } : e));
      return s.extensions;
    },
    extension_install: (a) => {
      const dir = str(a, "dir");
      const id = baseName(dir).toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (s.extensions.some((e) => e.manifest.id === id)) throw "An extension with that id is already installed.";
      s.extensions = [
        ...s.extensions,
        {
          manifest: { id, name: baseName(dir), version: "0.1.0", description: "Installed from a folder.", author: null, main: "worker.js", panel: null, permissions: ["notify"] },
          enabled: false,
          dir,
          error: null,
          builtin: false,
        },
      ];
      return s.extensions;
    },
    extension_uninstall: (a) => {
      const e = s.extensions.find((x) => x.manifest.id === str(a, "id"));
      if (e?.builtin) throw "Built-in extensions can't be uninstalled, only turned off.";
      s.extensions = s.extensions.filter((x) => x.manifest.id !== str(a, "id"));
      return s.extensions;
    },
    extension_source: () => "",
    extension_call: () => null,
  };

  // Gentle progress so pnpm dev feels alive. Off in tests.
  if (opts.simulate) {
    setInterval(() => {
      for (const j of s.jobs) {
        if (j.status.kind !== "downloading" && j.status.kind !== "recovering") continue;
        j.bytes = Math.min(j.total, j.bytes + j.speed);
        if (j.bytes >= j.total) {
          j.status = { kind: "done" };
          j.detail = "All files verified";
          j.speed = 0;
          j.finishedMs = Date.now();
        }
        emit("jobs:update", j);
      }
    }, 1000);
  }

  return {
    async invoke<T>(cmd: string, args: Args = {}): Promise<T> {
      const h = handlers[cmd];
      if (!h) throw `Unknown command ${cmd}`;
      if (latency) await new Promise((r) => setTimeout(r, latency));
      return structuredClone(h(args)) as T;
    },
    listen<T>(name: string, cb: (payload: T) => void): () => void {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      const l = cb as Listener;
      set.add(l);
      return () => set.delete(l);
    },
    emit,
    /** Back to the fixtures; tests call this between cases. */
    reset() {
      timers.forEach(clearTimeout);
      timers.clear();
      s = createState();
    },
  };
}

const isTest = import.meta.env.MODE === "test";
export const mockBackend = createMockBackend({ latency: isTest ? 0 : 120, simulate: !isTest });
