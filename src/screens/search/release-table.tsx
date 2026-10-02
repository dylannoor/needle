import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, type CSSProperties } from "react";
import type { Release } from "../../bindings/Release";
import { TableHead } from "../../components/layout";
import { Bar, GhostRows, SkeletonRows } from "../../components/ui/states";
import { StatusDot } from "../../components/ui/status";
import { cn } from "../../lib/cn";
import { isLossyLabel } from "../../lib/format";
import { availability, sizeText } from "../../lib/releases";

export const releaseGrid = "grid grid-cols-[minmax(150px,1fr)_110px_96px_136px_164px] items-center gap-4 px-3";

type Item = { kind: "release"; r: Release; hidden: boolean } | { kind: "divider"; count: number };

interface Props {
  releases: Release[];
  hidden: Release[];
  showHidden: boolean;
  owned: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  emptyLabel: string;
}

export function ReleaseTable({ releases, hidden, showHidden, owned, selectedId, onSelect, loading, emptyLabel }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const items: Item[] = releases.map((r) => ({ kind: "release", r, hidden: false }));
  if (showHidden && hidden.length) {
    items.push({ kind: "divider", count: hidden.length });
    for (const r of hidden) items.push({ kind: "release", r, hidden: true });
  }
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is fine without memoisation here.
  const v = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (items[i].kind === "divider" ? 44 : 52),
    overscan: 8,
  });

  const ghost = () => (
    <div className={cn(releaseGrid, "h-row")}>
      <Bar w="55%" />
      <Bar w="70%" />
      <Bar w="60%" />
      <Bar w="80%" />
      <Bar w="70%" />
    </div>
  );

  return (
    <div className="flex min-h-0 grow flex-col">
      <TableHead className={cn(releaseGrid, "mb-1")}>
        <span>Release</span>
        <span>Shared by</span>
        <span>Format</span>
        <span>Size</span>
        <span>Availability</span>
      </TableHead>
      {loading ? (
        <SkeletonRows row={ghost} count={6} />
      ) : items.length === 0 ? (
        <GhostRows row={ghost} count={6} label={emptyLabel} />
      ) : (
        <div ref={scrollRef} role="listbox" aria-label="Releases" className="min-h-0 grow overflow-auto">
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {v.getVirtualItems().map((vi) => {
              const it = items[vi.index];
              const style = { position: "absolute" as const, top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` };
              if (it.kind === "divider") {
                return (
                  <div key="divider" style={{ ...style, height: 44 }} className="flex items-end px-3 pb-2 text-[12px] text-faint">
                    Hidden by your profile
                  </div>
                );
              }
              return <ReleaseRow key={it.r.id} style={style} r={it.r} hidden={it.hidden} owned={owned.has(it.r.id)} selected={it.r.id === selectedId} onSelect={onSelect} reason={it.hidden ? (it.r.hiddenReason ?? "Hidden by your profile") : null} />;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ReleaseRow({ r, hidden, owned, selected, onSelect, reason, style }: { r: Release; hidden: boolean; owned: boolean; selected: boolean; onSelect: (id: string) => void; reason: string | null; style: CSSProperties }) {
  const avail = availability(r);
  const size = sizeText(r);
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      style={style}
      onClick={() => onSelect(r.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(r.id);
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const sib = (e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling) as HTMLElement | null;
          sib?.focus();
          sib?.click();
        }
      }}
      className={cn(releaseGrid, "h-row cursor-pointer rounded-ctl outline-offset-[-2px] transition-colors duration-150", selected ? "bg-selected" : "hover:bg-raised", hidden && "opacity-55")}
    >
      <div className="min-w-0">
        <div className="truncate">
          <span className="font-semibold">{r.title}</span>
          {r.artist && <span className="text-muted">{"  "}{r.artist}</span>}
        </div>
        {reason ? <div className="truncate text-[12px] text-warn" title={reason}>{reason}</div> : owned && <div className="truncate text-[12px] text-ok">You have this</div>}
      </div>
      <span className="truncate text-muted">{r.best.source.username}</span>
      <span className={isLossyLabel(r.formatLabel) ? "text-muted" : "text-text"}>{r.formatLabel}</span>
      <span className={cn(size.partial ? "text-warn" : "text-muted")}>{size.text}</span>
      <span className="flex min-w-0 items-center gap-2">
        <StatusDot tone={avail.tone} />
        <span className="truncate text-muted">{avail.text}</span>
      </span>
    </div>
  );
}
