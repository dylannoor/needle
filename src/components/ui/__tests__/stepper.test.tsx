import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Stepper } from "../stepper";

function Controlled({ initial, onChange, ...props }: { initial: number; onChange?: (n: number) => void; min?: number; max?: number; step?: number }) {
  const [v, setV] = useState(initial);
  return (
    <Stepper
      id="s"
      aria-label="Slots"
      value={v}
      onChange={(n) => {
        setV(n);
        onChange?.(n);
      }}
      {...props}
    />
  );
}

const input = () => screen.getByRole("spinbutton", { name: "Slots" });

describe("Stepper", () => {
  it("steps up and down with the chevrons", async () => {
    const onChange = vi.fn();
    render(<Controlled initial={3} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Increase" }));
    expect(input()).toHaveValue(4);
    await userEvent.click(screen.getByRole("button", { name: "Decrease" }));
    await userEvent.click(screen.getByRole("button", { name: "Decrease" }));
    expect(input()).toHaveValue(2);
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([4, 3, 2]);
  });

  it("uses the step size", async () => {
    render(<Controlled initial={0} step={32} max={320} />);
    await userEvent.click(screen.getByRole("button", { name: "Increase" }));
    expect(input()).toHaveValue(32);
  });

  it("stops at max and disables the up chevron there", async () => {
    const onChange = vi.fn();
    render(<Controlled initial={19} max={20} onChange={onChange} />);
    const up = screen.getByRole("button", { name: "Increase" });
    await userEvent.click(up);
    expect(input()).toHaveValue(20);
    expect(up).toBeDisabled();
    await userEvent.click(up);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("disables the down chevron at min", () => {
    render(<Controlled initial={0} min={0} />);
    expect(screen.getByRole("button", { name: "Decrease" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Increase" })).toBeEnabled();
  });

  it("commits typed values on blur, not while typing", async () => {
    const onChange = vi.fn();
    render(<Controlled initial={3} onChange={onChange} />);
    await userEvent.clear(input());
    await userEvent.type(input(), "12");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledWith(12);
    expect(input()).toHaveValue(12);
  });

  it("commits on Enter", async () => {
    const onChange = vi.fn();
    render(<Controlled initial={3} onChange={onChange} />);
    await userEvent.clear(input());
    await userEvent.type(input(), "7{Enter}");
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("clamps typed values that are out of range", async () => {
    const onChange = vi.fn();
    render(<Controlled initial={3} min={1} max={20} onChange={onChange} />);
    await userEvent.clear(input());
    await userEvent.type(input(), "500");
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith(20);
    await userEvent.clear(input());
    await userEvent.type(input(), "0");
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("restores the old value when the field is left empty", async () => {
    const onChange = vi.fn();
    render(<Controlled initial={3} onChange={onChange} />);
    await userEvent.clear(input());
    await userEvent.tab();
    expect(onChange).not.toHaveBeenCalled();
    expect(input()).toHaveValue(3);
  });

  it("steps with the arrow keys", async () => {
    render(<Controlled initial={5} />);
    await userEvent.click(input());
    await userEvent.keyboard("{ArrowUp}{ArrowUp}{ArrowDown}");
    expect(input()).toHaveValue(6);
  });
});
