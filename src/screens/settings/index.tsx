import { cn } from "../../lib/cn";
import { useNav, type SettingsPage } from "../../lib/nav";
import { AccountPage, ChatPage, DownloadsPage, NetworkPage } from "./pages";
import { QualityProfilePage } from "./quality-profile";

const pages: { id: SettingsPage; label: string }[] = [
  { id: "profile", label: "Quality profile" },
  { id: "downloads", label: "Downloads" },
  { id: "network", label: "Network" },
  { id: "chat", label: "Chat" },
  { id: "account", label: "Account" },
];

export function SettingsScreen() {
  const nav = useNav();
  const Page = { profile: QualityProfilePage, downloads: DownloadsPage, network: NetworkPage, chat: ChatPage, account: AccountPage }[nav.settingsPage];
  return (
    <div className="flex min-w-0 grow">
      <nav aria-label="Settings" className="flex w-[200px] shrink-0 flex-col gap-0.5 border-r border-line px-2.5">
        <div data-tauri-drag-region className="flex h-topbar shrink-0 items-center px-2.5">
          <h1 data-tauri-drag-region>Settings</h1>
        </div>
        <div className="h-3" />
        {pages.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-current={nav.settingsPage === p.id ? "page" : undefined}
            onClick={() => nav.setSettingsPage(p.id)}
            className={cn(
              "flex h-control items-center rounded-ctl border-0 px-2.5 text-left font-medium transition-colors duration-150",
              nav.settingsPage === p.id ? "bg-selected text-text" : "bg-transparent text-muted hover:bg-raised hover:text-text",
            )}
          >
            {p.label}
          </button>
        ))}
      </nav>
      <Page />
    </div>
  );
}
