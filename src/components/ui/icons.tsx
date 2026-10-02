// Icons. Most rail icons and the logo are drawn to match the mockups; the rest
// come from lucide with the same 1.6 stroke.
import * as L from "lucide-react";
import type { LucideIcon, LucideProps } from "lucide-react";
import type { SVGProps } from "react";

const withDefaults = (C: LucideIcon) => {
  const Icon = (p: LucideProps) => <C size={16} strokeWidth={1.6} aria-hidden="true" {...p} />;
  Icon.displayName = C.displayName;
  return Icon;
};

export const ChevronDown = withDefaults(L.ChevronDown);
export const ChevronRight = withDefaults(L.ChevronRight);
export const Check = withDefaults(L.Check);
export const X = withDefaults(L.X);
export const Plus = withDefaults(L.Plus);
export const Lock = withDefaults(L.Lock);
export const Folder = withDefaults(L.Folder);
export const FolderOpen = withDefaults(L.FolderOpen);
export const Warning = withDefaults(L.TriangleAlert);
export const Send = withDefaults(L.SendHorizontal);
export const MoreHorizontal = withDefaults(L.Ellipsis);
export const Pencil = withDefaults(L.Pencil);
export const Heart = withDefaults(L.Heart);
export const ThumbsDown = withDefaults(L.ThumbsDown);
export const History = withDefaults(L.History);
export const Star = withDefaults(L.Star);
export const RefreshCw = withDefaults(L.RefreshCw);
export const Download = withDefaults(L.Download);
export const User = withDefaults(L.User);
export const Search = withDefaults(L.Search);

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 17,
  height: 17,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  className: "shrink-0",
  ...p,
});

export const RailIcons = {
  search: (p: P) => (
    <svg {...base(p)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  transfers: (p: P) => (
    <svg {...base(p)}>
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  ),
  library: (p: P) => (
    <svg {...base(p)}>
      <path d="M4 5h4v15H4z" />
      <path d="M10 5h4v15h-4z" />
      <path d="m16 6 3.4-.9 3.1 14.4-3.4.9z" />
    </svg>
  ),
  rooms: (p: P) => (
    <svg {...base(p)}>
      <path d="M4 5h16v11H9l-5 4z" />
    </svg>
  ),
  messages: (p: P) => (
    <svg {...base(p)}>
      <path d="M4 6h16v12H4z" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  ),
  users: (p: P) => (
    <svg {...base(p)}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
      <path d="M18 14c2 .8 3 2.8 3 6" />
    </svg>
  ),
  extensions: (p: P) => <L.Puzzle size={17} strokeWidth={1.6} aria-hidden="true" className="shrink-0" {...(p as LucideProps)} />,
  settings: (p: P) => <L.Settings size={17} strokeWidth={1.6} aria-hidden="true" className="shrink-0" {...(p as LucideProps)} />,
};

export const Logo = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="11" cy="11" r="9" />
    <circle cx="11" cy="11" r="1.6" fill="currentColor" />
    <path d="M19.5 2.5 13 9" />
  </svg>
);

export const DragHandle = () => (
  <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" className="shrink-0 fill-idle">
    <circle cx="2.5" cy="2.5" r="1.2" />
    <circle cx="7.5" cy="2.5" r="1.2" />
    <circle cx="2.5" cy="7" r="1.2" />
    <circle cx="7.5" cy="7" r="1.2" />
    <circle cx="2.5" cy="11.5" r="1.2" />
    <circle cx="7.5" cy="11.5" r="1.2" />
  </svg>
);
