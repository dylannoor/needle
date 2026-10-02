import { Tooltip as R } from "radix-ui";
import type { ReactNode } from "react";

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <R.Provider delayDuration={400} skipDelayDuration={200}>
    {children}
  </R.Provider>
);

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <R.Root>
      <R.Trigger asChild>{children}</R.Trigger>
      <R.Portal>
        <R.Content sideOffset={6} className="z-50 max-w-[260px] rounded-sm border border-line-strong bg-raised-hi px-2 py-1 text-[12px] text-text">
          {content}
        </R.Content>
      </R.Portal>
    </R.Root>
  );
}
