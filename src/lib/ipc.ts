// Typed wrappers for every command and event in docs/ipc.md. Inside Tauri this
// talks to the Rust backend; in a plain browser (pnpm dev, tests) it talks to
// the in-memory mock backend in src/mocks so the UI works without Rust.
import type { Buddy } from "../bindings/Buddy";
import type { BrowseResult } from "../bindings/BrowseResult";
import type { ChatMessage } from "../bindings/ChatMessage";
import type { Conversation } from "../bindings/Conversation";
import type { ExtensionEvent } from "../bindings/ExtensionEvent";
import type { ExtensionInfo } from "../bindings/ExtensionInfo";
import type { FileInfo } from "../bindings/FileInfo";
import type { Interests } from "../bindings/Interests";
import type { JobView } from "../bindings/JobView";
import type { OwnedQuery } from "../bindings/OwnedQuery";
import type { QualityProfile } from "../bindings/QualityProfile";
import type { Recommendation } from "../bindings/Recommendation";
import type { RoomEventPayload } from "../bindings/RoomEventPayload";
import type { RoomSummary } from "../bindings/RoomSummary";
import type { RoomView } from "../bindings/RoomView";
import type { SearchView } from "../bindings/SearchView";
import type { SessionStatus } from "../bindings/SessionStatus";
import type { Settings } from "../bindings/Settings";
import type { SharesView } from "../bindings/SharesView";
import type { UploadsView } from "../bindings/UploadsView";
import type { UserProfile } from "../bindings/UserProfile";
import type { Visibility } from "../bindings/Visibility";
import type { WishItem } from "../bindings/WishItem";
import type { JsonValue } from "../bindings/serde_json/JsonValue";

export type Args = Record<string, unknown>;

export interface Transport {
  invoke<T>(cmd: string, args?: Args): Promise<T>;
  listen<T>(event: string, cb: (payload: T) => void): () => void;
}

export interface Events {
  session: SessionStatus;
  "search:update": SearchView;
  "jobs:update": JobView;
  "uploads:update": UploadsView;
  "shares:update": SharesView;
  "buddies:update": Buddy[];
  "room:event": RoomEventPayload;
  "pm:message": ChatMessage;
  "wishlist:hit": WishItem;
  "ext:event": { id: string; event: ExtensionEvent };
}

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const tauriTransport = (): Transport => {
  const core = import("@tauri-apps/api/core");
  const event = import("@tauri-apps/api/event");
  return {
    invoke: async (cmd, args) => (await core).invoke(cmd, args),
    listen: (name, cb) => {
      let stop: (() => void) | null = null;
      let cancelled = false;
      void event.then((e) =>
        e.listen<Parameters<typeof cb>[0]>(name, (msg) => cb(msg.payload)).then((un) => {
          if (cancelled) un();
          else stop = un;
        }),
      );
      return () => {
        cancelled = true;
        stop?.();
      };
    },
  };
};

const mockTransport = (): Transport => {
  const backend = import("../mocks/backend").then((m) => m.mockBackend);
  return {
    invoke: async (cmd, args) => (await backend).invoke(cmd, args),
    listen: (name, cb) => {
      let stop: (() => void) | null = null;
      let cancelled = false;
      void backend.then((b) => {
        if (!cancelled) stop = b.listen(name, cb);
      });
      return () => {
        cancelled = true;
        stop?.();
      };
    },
  };
};

const transport: Transport = inTauri ? tauriTransport() : mockTransport();

const call = <T>(cmd: string, args?: Args) => transport.invoke<T>(cmd, args);

/** Subscribe to a backend event. Returns the unsubscribe function. */
export function on<K extends keyof Events>(name: K, cb: (payload: Events[K]) => void): () => void {
  return transport.listen<Events[K]>(name, cb);
}

/** Errors come back from Rust as plain strings; normalise anything else. */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}

export const api = {
  // Session
  sessionStatus: () => call<SessionStatus>("session_status"),
  login: (username: string, password: string, remember: boolean) =>
    call<SessionStatus>("login", { username, password, remember }),
  logout: () => call<SessionStatus>("logout"),
  setAway: (away: boolean) => call<SessionStatus>("set_away", { away }),

  // Search
  searchStart: (query: string, profileId: string | null) => call<string>("search_start", { query, profileId }),
  searchView: (searchId: string, profileId: string | null, includeHidden: boolean) =>
    call<SearchView>("search_view", { searchId, profileId, includeHidden }),
  searchCancel: (searchId: string) => call<void>("search_cancel", { searchId }),
  searchHistory: () => call<string[]>("search_history"),
  searchUser: (username: string, query: string) => call<string>("search_user", { username, query }),
  searchRoom: (room: string, query: string) => call<string>("search_room", { room, query }),

  // Downloads
  downloadRelease: (searchId: string, releaseId: string, files: string[] | null) =>
    call<JobView>("download_release", { searchId, releaseId, files }),
  downloadFiles: (username: string, folder: string, files: FileInfo[]) =>
    call<JobView>("download_files", { username, folder, files }),
  jobsList: () => call<JobView[]>("jobs_list"),
  jobPause: (jobId: string) => call<JobView>("job_pause", { jobId }),
  jobResume: (jobId: string) => call<JobView>("job_resume", { jobId }),
  jobCancel: (jobId: string) => call<JobView>("job_cancel", { jobId }),
  jobRetry: (jobId: string) => call<JobView>("job_retry", { jobId }),
  jobRemove: (jobId: string) => call<void>("job_remove", { jobId }),
  jobsClearFinished: () => call<void>("jobs_clear_finished"),
  jobKeepFile: (jobId: string, name: string) => call<JobView>("job_keep_file", { jobId, name }),
  jobReveal: (jobId: string) => call<void>("job_reveal", { jobId }),

  // Uploads
  uploadsView: () => call<UploadsView>("uploads_view"),
  uploadCancel: (username: string, path: string) => call<void>("upload_cancel", { username, path }),

  // Library and shares
  sharesView: () => call<SharesView>("shares_view"),
  shareAdd: (path: string, visibility: Visibility) => call<SharesView>("share_add", { path, visibility }),
  shareRemove: (path: string) => call<SharesView>("share_remove", { path }),
  shareSetVisibility: (path: string, visibility: Visibility) =>
    call<SharesView>("share_set_visibility", { path, visibility }),
  sharesRescan: () => call<SharesView>("shares_rescan"),
  pickFolder: () => call<string | null>("pick_folder"),
  ownedCheck: (files: OwnedQuery[]) => call<boolean[]>("owned_check", { files }),

  // Settings and profiles
  settingsGet: () => call<Settings>("settings_get"),
  settingsSet: (settings: Settings) => call<Settings>("settings_set", { settings }),
  profilesList: () => call<QualityProfile[]>("profiles_list"),
  profileSave: (profile: QualityProfile) => call<QualityProfile[]>("profile_save", { profile }),
  profileDelete: (id: string) => call<QualityProfile[]>("profile_delete", { id }),
  profilePreview: (profile: QualityProfile) => call<[number, number] | null>("profile_preview", { profile }),

  // Users and buddies
  userProfile: (username: string) => call<UserProfile>("user_profile", { username }),
  buddiesList: () => call<Buddy[]>("buddies_list"),
  buddyAdd: (username: string) => call<Buddy[]>("buddy_add", { username }),
  buddyRemove: (username: string) => call<Buddy[]>("buddy_remove", { username }),
  buddyNote: (username: string, note: string) => call<Buddy[]>("buddy_note", { username, note }),
  userBan: (username: string) => call<void>("user_ban", { username }),
  userUnban: (username: string) => call<void>("user_unban", { username }),
  userIgnore: (username: string) => call<void>("user_ignore", { username }),
  userUnignore: (username: string) => call<void>("user_unignore", { username }),
  blockedList: () => call<{ banned: string[]; ignored: string[] }>("blocked_list"),
  browseUser: (username: string) => call<BrowseResult>("browse_user", { username }),

  // Chat
  roomsList: () => call<RoomSummary[]>("rooms_list"),
  roomJoin: (room: string) => call<RoomView>("room_join", { room }),
  roomLeave: (room: string) => call<void>("room_leave", { room }),
  roomView: (room: string) => call<RoomView>("room_view", { room }),
  roomSay: (room: string, text: string) => call<void>("room_say", { room, text }),
  roomSetTicker: (room: string, text: string) => call<void>("room_set_ticker", { room, text }),
  conversationsList: () => call<Conversation[]>("conversations_list"),
  conversation: (username: string) => call<ChatMessage[]>("conversation", { username }),
  pmSend: (username: string, text: string) => call<ChatMessage>("pm_send", { username, text }),
  pmMarkRead: (username: string) => call<void>("pm_mark_read", { username }),

  // Interests and wishlist
  interestsGet: () => call<Interests>("interests_get"),
  interestAdd: (item: string, like: boolean) => call<Interests>("interest_add", { item, like }),
  interestRemove: (item: string, like: boolean) => call<Interests>("interest_remove", { item, like }),
  recommendations: (global: boolean) => call<Recommendation[]>("recommendations", { global }),
  similarUsers: () => call<string[]>("similar_users"),
  wishlistList: () => call<WishItem[]>("wishlist_list"),
  wishlistAdd: (query: string) => call<WishItem[]>("wishlist_add", { query }),
  wishlistRemove: (query: string) => call<WishItem[]>("wishlist_remove", { query }),

  // Extensions
  extensionsList: () => call<ExtensionInfo[]>("extensions_list"),
  extensionSetEnabled: (id: string, enabled: boolean) => call<ExtensionInfo[]>("extension_set_enabled", { id, enabled }),
  extensionInstall: (dir: string) => call<ExtensionInfo[]>("extension_install", { dir }),
  extensionUninstall: (id: string) => call<ExtensionInfo[]>("extension_uninstall", { id }),
  extensionSource: (id: string, file: string) => call<string>("extension_source", { id, file }),
  extensionCall: (id: string, method: string, args: JsonValue) =>
    call<JsonValue>("extension_call", { id, method, args }),
};
