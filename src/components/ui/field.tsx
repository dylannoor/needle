import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/** Settings row: label on the left, control on the right, hairline below. */
export function Field({ label, htmlFor, labelId, hint, children, last, className }: { label: ReactNode; htmlFor?: string; labelId?: string; hint?: ReactNode; children: ReactNode; last?: boolean; className?: string }) {
  return (
    <div className={cn("flex min-h-row items-center justify-between gap-4 py-2", !last && "border-b border-selected", className)}>
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} id={labelId}>
            {label}
          </label>
        ) : (
          <span id={labelId}>{label}</span>
        )}
        {hint && <div className="text-[12px] text-faint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function SectionTitle({ children, hint, className, id }: { children: ReactNode; hint?: ReactNode; className?: string; id?: string }) {
  return (
    <div className={className}>
      <h2 id={id} className="text-[15px]">
        {children}
      </h2>
      {hint && <p className="mt-1 mb-0 text-[13px] text-faint">{hint}</p>}
    </div>
  );
}
