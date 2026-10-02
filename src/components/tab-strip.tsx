import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { X } from "./ui/icons";

export interface StripTab {
  id: string;
  label: string;
  icon?: ReactNode;
}

const tabCls = (on: boolean) =>
  cn(
    "flex h-11 shrink-0 items-center gap-2 border-0 border-b-2 bg-transparent px-1 text-[13px] font-medium transition-colors duration-150",
    on ? "border-text text-text" : "border-transparent text-muted hover:text-text",
  );

/** Row of closable tabs under a top bar (searches, joined rooms). */
export function TabStrip({ tabs, active, onSelect, onClose, label, trailing }: { tabs: StripTab[]; active: string | null; onSelect: (id: string) => void; onClose?: (id: string) => void; label: string; trailing?: ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-5 border-b border-line px-7">
      <div role="tablist" aria-label={label} className="flex min-w-0 gap-5 overflow-x-auto">
        {tabs.map((t) => (
          <div key={t.id} className={tabCls(t.id === active)}>
            <button type="button" role="tab" aria-selected={t.id === active} onClick={() => onSelect(t.id)} className="flex max-w-[220px] items-center gap-1.5 border-0 bg-transparent p-0 text-inherit">
              {t.icon}
              <span className="truncate">{t.label}</span>
            </button>
            {onClose && (
              <button type="button" aria-label={`Close ${t.label}`} onClick={() => onClose(t.id)} className="grid h-5 w-5 place-items-center rounded-[4px] border-0 bg-transparent text-faint hover:bg-raised-hi hover:text-text">
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div data-tauri-drag-region className="h-full grow" />
      {trailing}
    </div>
  );
}

/** A tab-looking toggle for the trailing slot ("Wishlist"). */
export function StripToggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className={tabCls(pressed)}>
      {children}
    </button>
  );
}
