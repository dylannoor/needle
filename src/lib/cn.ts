import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge our token sizes so `w-[240px]` overrides `w-aside`.
const twMerge = extendTailwindMerge({
  extend: { theme: { spacing: ["row", "control", "topbar", "rail", "drag", "aside", "aside-wide"] } },
});

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
