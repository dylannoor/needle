// Loading, empty and error states. Empty states are ghost rows: faded
// placeholders that mirror the real layout, with a small centered label.
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "./button";

/** One placeholder bar. `w` is a Tailwind width class or percentage. */
export const Bar = ({ w = "60%", className }: { w?: string; className?: string }) => (
  <span className={cn("block h-2.5 rounded-[3px] bg-raised-hi", className)} style={{ width: w }} />
);

interface RowsProps {
  /** Renders one placeholder row. Should reuse the real row's grid and height. */
  row: (i: number) => ReactNode;
  count?: number;
  className?: string;
}

export function GhostRows({ row, count = 4, label, action, className }: RowsProps & { label: ReactNode; action?: ReactNode }) {
  return (
    <div className={cn("relative", className)}>
      <div aria-hidden="true" className="pointer-events-none opacity-[0.28]">
        {Array.from({ length: count }, (_, i) => (
          <div key={i}>{row(i)}</div>
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex items-center gap-3 rounded-lg bg-bg/80 px-3.5 py-2 text-[13px] text-muted backdrop-blur-[2px]">
          <span>{label}</span>
          {action}
        </div>
      </div>
    </div>
  );
}

export function SkeletonRows({ row, count = 4, className }: RowsProps) {
  return (
    <div aria-busy="true" aria-label="Loading" className={cn("animate-pulse", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>{row(i)}</div>
      ))}
    </div>
  );
}

export function InlineError({ message, onRetry, retryLabel = "Try again" }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-ctl border border-bad/30 bg-bad/8 px-3 py-2 text-[13px]">
      <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-bad" aria-hidden="true" />
      <span className="grow text-text">{message}</span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
