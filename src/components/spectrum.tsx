import type { Verdict } from "../bindings/Verdict";
import { cn } from "../lib/cn";

const khz = (hz: number) => `${Math.round(hz / 100) / 10} kHz`.replace(".0 ", " ");

/** Average spectrum as bars with a dashed marker where it falls off a cliff. */
export function Spectrum({ verdict }: { verdict: Verdict }) {
  const bands = verdict.spectrum;
  const lo = Math.min(...bands);
  const hi = Math.max(...bands);
  const range = hi - lo || 1;
  const nyq = verdict.nyquistHz;
  const cut = verdict.cutoffHz;
  const ticks = [0, 5000, 10000, 15000, 20000].filter((t) => t < nyq - 2500);
  const label = cut ? `Spectrum of the file. It stops at ${khz(cut)} out of ${khz(nyq)}.` : `Spectrum of the file. It reaches ${khz(nyq)}.`;
  return (
    <figure className="m-0" role="img" aria-label={label}>
      <div className="relative flex h-[120px] items-end gap-0.5 border-b border-line-strong">
        {bands.map((db, i) => {
          const center = ((i + 0.5) / bands.length) * nyq;
          const above = cut !== null && center > cut;
          return <div key={i} className={cn("grow rounded-t-[1px]", above ? "bg-line-strong" : "bg-spectrum")} style={{ height: `${2 + ((db - lo) / range) * 98}%` }} />;
        })}
        {cut !== null && <div data-testid="cutoff" className="absolute top-0 bottom-0 border-l border-dashed border-warn" style={{ left: `${(cut / nyq) * 100}%` }} />}
      </div>
      <div className="relative h-5 text-[12px] text-faint">
        {ticks.map((t) => (
          <span key={t} className="absolute top-1.5" style={{ left: `${(t / nyq) * 100}%`, transform: t ? "translateX(-50%)" : undefined }}>
            {t / 1000}
          </span>
        ))}
        <span className="absolute top-1.5 right-0">{Math.round(nyq / 1000)} kHz</span>
      </div>
    </figure>
  );
}
