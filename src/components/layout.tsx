import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/** Screen header, 72px. Empty parts drag the window (macOS overlay title bar). */
export function TopBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header data-tauri-drag-region className={cn("flex h-topbar shrink-0 items-center gap-2.5 border-b border-line px-7", className)}>
      {children}
    </header>
  );
}

/** Flexible empty space inside a TopBar; also a drag handle. */
export const Spacer = () => <div data-tauri-drag-region className="h-full grow" />;

export function Screen({ children }: { children: ReactNode }) {
  return <main className="flex min-w-0 grow flex-col">{children}</main>;
}

/** Content row under the top bar: main column plus optional aside. */
export function Body({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-h-0 grow", className)}>{children}</div>;
}

export function Aside({ children, label, wide, className }: { children: ReactNode; label: string; wide?: boolean; className?: string }) {
  return (
    <aside aria-label={label} className={cn("flex shrink-0 flex-col border-l border-line", wide ? "w-aside-wide" : "w-aside", className)}>
      {children}
    </aside>
  );
}

/** Big title used at the top of asides. */
export function AsideTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("text-[20px] leading-tight font-[650] tracking-[-0.015em]", className)}>{children}</h2>;
}

/** Faint column header row for tables. Pass the same grid class as the rows. */
export function TableHead({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("h-8 border-b border-line text-[12px] text-faint", className)}>{children}</div>;
}
