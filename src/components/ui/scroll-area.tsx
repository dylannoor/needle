import { ScrollArea as R } from "radix-ui";
import type { ReactNode, Ref } from "react";
import { cn } from "../../lib/cn";

/** Themed scroll container. Pass viewportRef to drive virtualisation or stick-to-bottom. */
export function ScrollArea({ children, className, viewportClassName, viewportRef }: { children: ReactNode; className?: string; viewportClassName?: string; viewportRef?: Ref<HTMLDivElement> }) {
  return (
    <R.Root type="hover" className={cn("relative min-h-0 overflow-hidden", className)}>
      <R.Viewport ref={viewportRef} className={cn("h-full w-full [&>div]:!block", viewportClassName)}>
        {children}
      </R.Viewport>
      <R.Scrollbar orientation="vertical" className="flex w-2.5 touch-none p-0.5 select-none">
        <R.Thumb className="relative flex-1 rounded-full bg-line-strong hover:bg-idle" />
      </R.Scrollbar>
    </R.Root>
  );
}
