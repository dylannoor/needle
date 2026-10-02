// TanStack Query hooks over the IPC API. Backend events write straight into
// the cache (see useBackendEvents), so screens never poll.
import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { JobView } from "../bindings/JobView";
import type { RoomView } from "../bindings/RoomView";
import type { ChatMessage } from "../bindings/ChatMessage";
import type { Settings } from "../bindings/Settings";
import { api, on } from "./ipc";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false },
  },
});

export const keys = {
  session: ["session"] as const,
  settings: ["settings"] as const,
  profiles: ["profiles"] as const,
  history: ["searchHistory"] as const,
  search: (id: string) => ["search", id] as const,
  searchView: (id: string, profileId: string | null, includeHidden: boolean) => ["search", id, profileId, includeHidden] as const,
  owned: (files: { path: string; size: number }[]) => ["owned", files] as const,
  jobs: ["jobs"] as const,
  uploads: ["uploads"] as const,
  shares: ["shares"] as const,
  buddies: ["buddies"] as const,
  blocked: ["blocked"] as const,
  user: (u: string) => ["user", u] as const,
  browse: (u: string) => ["browse", u] as const,
  rooms: ["rooms"] as const,
  room: (r: string) => ["room", r] as const,
  conversations: ["conversations"] as const,
  conversation: (u: string) => ["conversation", u] as const,
  interests: ["interests"] as const,
  recommendations: (global: boolean) => ["recommendations", global] as const,
  similar: ["similarUsers"] as const,
  wishlist: ["wishlist"] as const,
  extensions: ["extensions"] as const,
  preview: ["profilePreview"] as const,
};

export const useSession = () => useQuery({ queryKey: keys.session, queryFn: api.sessionStatus });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.settingsGet });
export const useProfiles = () => useQuery({ queryKey: keys.profiles, queryFn: api.profilesList });
export const useJobs = () => useQuery({ queryKey: keys.jobs, queryFn: api.jobsList });
export const useUploads = () => useQuery({ queryKey: keys.uploads, queryFn: api.uploadsView });
export const useShares = () => useQuery({ queryKey: keys.shares, queryFn: api.sharesView });
export const useBuddies = () => useQuery({ queryKey: keys.buddies, queryFn: api.buddiesList });
export const useBlocked = () => useQuery({ queryKey: keys.blocked, queryFn: api.blockedList });
export const useRooms = () => useQuery({ queryKey: keys.rooms, queryFn: api.roomsList });
export const useConversations = () => useQuery({ queryKey: keys.conversations, queryFn: api.conversationsList });
export const useInterests = () => useQuery({ queryKey: keys.interests, queryFn: api.interestsGet });
export const useWishlist = () => useQuery({ queryKey: keys.wishlist, queryFn: api.wishlistList });
export const useExtensions = () => useQuery({ queryKey: keys.extensions, queryFn: api.extensionsList });

export const useRoom = (room: string | null) =>
  useQuery({ queryKey: keys.room(room ?? ""), queryFn: () => api.roomView(room ?? ""), enabled: Boolean(room) });
export const useConversation = (u: string | null) =>
  useQuery({ queryKey: keys.conversation(u ?? ""), queryFn: () => api.conversation(u ?? ""), enabled: Boolean(u) });
export const useUserProfile = (u: string | null) =>
  useQuery({ queryKey: keys.user(u ?? ""), queryFn: () => api.userProfile(u ?? ""), enabled: Boolean(u), staleTime: 30_000 });

/** Settings are saved whole; this merges a partial change into the cached copy. */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => {
      const current = qc.getQueryData<Settings>(keys.settings);
      if (!current) throw "Settings haven't loaded yet.";
      const next = { ...current, ...patch };
      qc.setQueryData(keys.settings, next);
      return api.settingsSet(next);
    },
    onSuccess: (s) => qc.setQueryData(keys.settings, s),
    onError: () => qc.invalidateQueries({ queryKey: keys.settings }),
  });
}

export function upsertJob(list: JobView[] | undefined, job: JobView): JobView[] {
  if (!list) return [job];
  const i = list.findIndex((j) => j.id === job.id);
  if (i < 0) return [job, ...list];
  const next = list.slice();
  next[i] = job;
  return next;
}

/** Wire backend events into the query cache. Mount once, after login. */
export function useBackendEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    const offs = [
      on("session", (s) => qc.setQueryData(keys.session, s)),
      on("search:update", (v) => {
        const active = qc.getQueryData<Settings>(keys.settings)?.activeProfileId ?? null;
        qc.setQueryData(keys.searchView(v.searchId, active, false), v);
        void qc.invalidateQueries({
          queryKey: keys.search(v.searchId),
          predicate: (q) => !(q.queryKey[2] === active && q.queryKey[3] === false),
        });
      }),
      on("jobs:update", (j) => qc.setQueryData<JobView[]>(keys.jobs, (l) => upsertJob(l, j))),
      on("uploads:update", (u) => qc.setQueryData(keys.uploads, u)),
      on("shares:update", (s) => qc.setQueryData(keys.shares, s)),
      on("buddies:update", (b) => qc.setQueryData(keys.buddies, b)),
      on("wishlist:hit", () => void qc.invalidateQueries({ queryKey: keys.wishlist })),
      on("pm:message", (m) => {
        qc.setQueryData<ChatMessage[]>(keys.conversation(m.channel), (l) => (l ? [...l, m] : l));
        void qc.invalidateQueries({ queryKey: keys.conversations });
      }),
      on("room:event", (e) => {
        if (e.kind === "listChanged") {
          void qc.invalidateQueries({ queryKey: keys.rooms });
          return;
        }
        const room = e.kind === "message" ? e.message.channel : e.room;
        qc.setQueryData<RoomView>(keys.room(room), (v) => {
          if (!v) return v;
          switch (e.kind) {
            case "message":
              return { ...v, messages: [...v.messages, e.message] };
            case "joined":
              return { ...v, members: [...v.members.filter((m) => m.username !== e.member.username), e.member] };
            case "left":
              return { ...v, members: v.members.filter((m) => m.username !== e.username) };
            case "ticker":
              return { ...v, tickers: [...v.tickers.filter(([u]) => u !== e.username), [e.username, e.text]] };
          }
        });
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [qc]);
}
