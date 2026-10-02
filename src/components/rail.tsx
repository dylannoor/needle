import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { useNav, type Screen } from "../lib/nav";
import { useConversations, useJobs, useSession } from "../lib/queries";
import { Logo, RailIcons } from "./ui/icons";
import { StatusDot } from "./ui/status";

const isActive = (k: string) => !["done", "failed", "cancelled"].includes(k);

function NavItem({ screen, icon, children, count }: { screen: Screen; icon: ReactNode; children: ReactNode; count?: number }) {
  const nav = useNav();
  const current = nav.screen === screen;
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      onClick={() => nav.go(screen)}
      className={cn(
        "flex h-control w-full items-center gap-[11px] rounded-ctl border-0 px-2.5 text-left font-medium transition-colors duration-150",
        current ? "bg-selected text-text" : "bg-transparent text-muted hover:bg-raised hover:text-text",
      )}
    >
      {icon}
      {children}
      {count ? <span className="ml-auto text-[12px] text-faint">{count}</span> : null}
    </button>
  );
}

export function Rail() {
  const jobs = useJobs().data ?? [];
  const unread = (useConversations().data ?? []).reduce((a, c) => a + c.unread, 0);
  const session = useSession().data;
  const active = jobs.filter((j) => isActive(j.status.kind)).length;
  const status = !session
    ? { tone: "idle" as const, text: "Starting" }
    : session.state === "online"
      ? session.away
        ? { tone: "warn" as const, text: `Away as ${session.username}` }
        : { tone: "ok" as const, text: `Online as ${session.username}` }
      : session.state === "connecting"
        ? session.error
          ? { tone: "warn" as const, text: "Reconnecting", detail: session.error }
          : { tone: "busy" as const, text: "Connecting" }
        : { tone: "bad" as const, text: session.error ? "Disconnected" : "Offline" };
  return (
    <nav aria-label="Main" className="flex w-rail shrink-0 flex-col gap-0.5 border-r border-line bg-rail px-2.5 pb-[18px]">
      <div data-tauri-drag-region className="h-drag shrink-0" />
      <div data-tauri-drag-region className="flex items-center gap-[9px] px-2.5 pt-0.5 pb-[18px] text-text">
        <Logo />
        <span className="text-[17px] font-bold tracking-[-0.02em]">Needle</span>
      </div>
      <NavItem screen="search" icon={<RailIcons.search />}>Search</NavItem>
      <NavItem screen="transfers" icon={<RailIcons.transfers />} count={active}>Transfers</NavItem>
      <NavItem screen="library" icon={<RailIcons.library />}>Library &amp; shares</NavItem>
      <NavItem screen="rooms" icon={<RailIcons.rooms />}>Rooms</NavItem>
      <NavItem screen="messages" icon={<RailIcons.messages />} count={unread}>Messages</NavItem>
      <NavItem screen="users" icon={<RailIcons.users />}>Users &amp; buddies</NavItem>
      <NavItem screen="extensions" icon={<RailIcons.extensions />}>Extensions</NavItem>
      <div data-tauri-drag-region className="grow" />
      <NavItem screen="settings" icon={<RailIcons.settings />}>Settings</NavItem>
      <div role="status" className="flex min-h-control flex-col justify-center px-2.5 text-[13px] text-muted">
        <span className="flex items-center gap-[9px]">
          <StatusDot tone={status.tone} />
          <span className="truncate">{status.text}</span>
        </span>
        {"detail" in status && <span className="pl-4 text-[12px] leading-snug text-faint">{status.detail}</span>}
      </div>
    </nav>
  );
}
