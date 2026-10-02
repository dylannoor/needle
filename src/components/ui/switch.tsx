import { Switch as RadixSwitch } from "radix-ui";
import { cn } from "../../lib/cn";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export function Switch({ checked, onCheckedChange, ...props }: SwitchProps) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={cn(
        "relative h-5 w-[34px] shrink-0 rounded-[10px] border-0 p-0 transition-colors duration-180 disabled:opacity-45",
        checked ? "bg-text" : "bg-switch-off",
      )}
      {...props}
    >
      <RadixSwitch.Thumb
        className={cn(
          "absolute top-[3px] left-[3px] block h-3.5 w-3.5 rounded-full transition-[transform,background-color] duration-180 ease-ui",
          checked ? "translate-x-3.5 bg-bg" : "bg-faint",
        )}
      />
    </RadixSwitch.Root>
  );
}
