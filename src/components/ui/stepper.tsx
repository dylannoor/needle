import { useState } from "react";
import { cn } from "../../lib/cn";

interface StepperProps {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Accessible names for the arrow buttons. */
  incLabel?: string;
  decLabel?: string;
  "aria-label"?: string;
  className?: string;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const Chevron = ({ up }: { up?: boolean }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={up ? "M2.5 6.25 5 3.75l2.5 2.5" : "M2.5 3.75 5 6.25l2.5-2.5"} />
  </svg>
);

/** Number field with stacked chevrons, no native spinners. Clamps to [min, max]. */
export function Stepper({ id, value, onChange, min = 0, max = 9999, step = 1, unit, incLabel = "Increase", decLabel = "Decrease", className, ...rest }: StepperProps) {
  // Draft text while typing; committed on blur or Enter so a half-typed "1" never saves.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    setDraft(null);
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && clamp(n, min, max) !== value) onChange(clamp(n, min, max));
  };
  const bump = (d: number) => {
    const n = clamp(value + d, min, max);
    if (n !== value) onChange(n);
  };
  const btn = "flex w-[22px] grow items-center justify-center text-muted hover:bg-raised-hi hover:text-text active:bg-line-strong disabled:opacity-40 disabled:pointer-events-none";
  return (
    <div className={cn("flex h-8 items-stretch overflow-hidden rounded-ctl border border-line-strong bg-input focus-within:border-focus", className)}>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        aria-label={rest["aria-label"]}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(e.currentTarget.value);
          if (e.key === "ArrowUp") {
            e.preventDefault();
            bump(step);
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            bump(-step);
          }
        }}
        className="w-11 border-0 bg-transparent px-1.5 text-right tabular-nums text-[13px] font-medium text-text outline-none"
      />
      {unit && <span className="flex items-center pr-[9px] text-[12px] text-faint">{unit}</span>}
      <div className="flex flex-col border-l border-line-strong">
        <button type="button" tabIndex={-1} aria-label={incLabel} className={btn} disabled={value >= max} onClick={() => bump(step)}>
          <Chevron up />
        </button>
        <button type="button" tabIndex={-1} aria-label={decLabel} className={cn(btn, "border-t border-line-strong")} disabled={value <= min} onClick={() => bump(-step)}>
          <Chevron />
        </button>
      </div>
    </div>
  );
}
