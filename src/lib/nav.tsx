// App-level navigation and cross-screen state (search tabs, which user or
// conversation is open). Plain React state: no router needed.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type Screen = "search" | "transfers" | "library" | "rooms" | "messages" | "users" | "extensions" | "settings";
export type SettingsPage = "profile" | "downloads" | "network" | "chat" | "account";
export type UsersView = { kind: "buddies" | "interests" | "blocked" } | { kind: "profile" | "browse"; username: string };

export interface SearchTab {
  id: string;
  label: string;
  /** Profile picked for this tab; null = the active profile from settings. */
  profileId: string | null;
}

interface Nav {
  screen: Screen;
  go: (s: Screen) => void;
  searchTabs: SearchTab[];
  activeSearch: string | null;
  openSearch: (tab: SearchTab) => void;
  closeSearch: (id: string) => void;
  setActiveSearch: (id: string | null) => void;
  setTabProfile: (id: string, profileId: string | null) => void;
  usersView: UsersView;
  setUsersView: (v: UsersView) => void;
  openUser: (username: string) => void;
  browseUser: (username: string) => void;
  conversation: string | null;
  messageUser: (username: string | null) => void;
  room: string | null;
  setRoom: (room: string | null) => void;
  settingsPage: SettingsPage;
  setSettingsPage: (p: SettingsPage) => void;
}

const Ctx = createContext<Nav | null>(null);

export function NavProvider({ children, initial = "search" }: { children: ReactNode; initial?: Screen }) {
  const [screen, go] = useState<Screen>(initial);
  const [searchTabs, setTabs] = useState<SearchTab[]>([]);
  const [activeSearch, setActiveSearch] = useState<string | null>(null);
  const [usersView, setUsersView] = useState<UsersView>({ kind: "buddies" });
  const [conversation, setConversation] = useState<string | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("profile");

  const openSearch = useCallback((tab: SearchTab) => {
    setTabs((t) => (t.some((x) => x.id === tab.id) ? t : [...t, tab]));
    setActiveSearch(tab.id);
    go("search");
  }, []);
  const closeSearch = useCallback(
    (id: string) => {
      const i = searchTabs.findIndex((x) => x.id === id);
      const next = searchTabs.filter((x) => x.id !== id);
      setTabs(next);
      if (activeSearch === id) setActiveSearch(next[Math.min(i, next.length - 1)]?.id ?? null);
    },
    [searchTabs, activeSearch],
  );
  const setTabProfile = useCallback((id: string, profileId: string | null) => setTabs((t) => t.map((x) => (x.id === id ? { ...x, profileId } : x))), []);

  const value = useMemo<Nav>(
    () => ({
      screen,
      go,
      searchTabs,
      activeSearch,
      openSearch,
      closeSearch,
      setActiveSearch,
      setTabProfile,
      usersView,
      setUsersView,
      openUser: (username) => {
        setUsersView({ kind: "profile", username });
        go("users");
      },
      browseUser: (username) => {
        setUsersView({ kind: "browse", username });
        go("users");
      },
      conversation,
      messageUser: (username) => {
        setConversation(username);
        go("messages");
      },
      room,
      setRoom,
      settingsPage,
      setSettingsPage,
    }),
    [screen, searchTabs, activeSearch, openSearch, closeSearch, setTabProfile, usersView, conversation, room, settingsPage],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNav(): Nav {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNav outside NavProvider");
  return v;
}
