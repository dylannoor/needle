import { cn } from "../../lib/cn";

export type Tone = "ok" | "busy" | "warn" | "bad" | "idle";

const dot: Record<Tone, string> = { ok: "bg-ok", busy: "bg-busy", warn: "bg-warn", bad: "bg-bad", idle: "bg-idle" };
const bar: Record<Tone, string> = dot;

export function StatusDot({ tone, className, label }: { tone: Tone; className?: string; label?: string }) {
  return <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn("h-[7px] w-[7px] shrink-0 rounded-full", dot[tone], className)} />;
}

export function ProgressBar({ value, tone = "busy", label }: { value: number; tone?: Tone; label?: string }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="h-[3px] rounded-[2px] bg-raised-hi">
      <div className={cn("h-[3px] rounded-[2px] transition-[width] duration-200", bar[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}
