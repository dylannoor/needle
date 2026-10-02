import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Checkbox } from "../checkbox";
import { RadioGroup } from "../radio-group";

function Box({ initial = false, disabled = false, onChange = vi.fn() }) {
  const [on, setOn] = useState(initial);
  return (
    <Checkbox
      label="Remember me"
      checked={on}
      disabled={disabled}
      onCheckedChange={(v) => {
        setOn(v);
        onChange(v);
      }}
    />
  );
}

describe("Checkbox", () => {
  it("toggles from the box and from its label", async () => {
    const onChange = vi.fn();
    render(<Box onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: "Remember me" });
    expect(box).not.toBeChecked();
    expect(box).toHaveAttribute("data-state", "unchecked");
    await userEvent.click(box);
    expect(box).toBeChecked();
    expect(box).toHaveAttribute("data-state", "checked");
    await userEvent.click(screen.getByText("Remember me"));
    expect(box).not.toBeChecked();
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([true, false]);
  });

  it("toggles with the space key", async () => {
    render(<Box />);
    const box = screen.getByRole("checkbox", { name: "Remember me" });
    box.focus();
    await userEvent.keyboard(" ");
    expect(box).toBeChecked();
  });

  it("ignores clicks when disabled", async () => {
    const onChange = vi.fn();
    render(<Box disabled onChange={onChange} />);
    await userEvent.click(screen.getByText("Remember me"));
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("only shows the check mark when checked", () => {
    const { rerender } = render(<Checkbox aria-label="Pick" checked={false} onCheckedChange={() => {}} />);
    expect(screen.getByRole("checkbox").querySelector("svg")).toBeNull();
    rerender(<Checkbox aria-label="Pick" checked onCheckedChange={() => {}} />);
    expect(screen.getByRole("checkbox").querySelector("svg")).not.toBeNull();
  });
});

describe("RadioGroup", () => {
  function Group({ onChange = vi.fn() }) {
    const [v, setV] = useState<"a" | "b">("a");
    return (
      <RadioGroup
        aria-label="On fail"
        value={v}
        onValueChange={(x) => {
          setV(x);
          onChange(x);
        }}
        options={[
          { value: "a", label: "Delete it" },
          { value: "b", label: "Move it aside" },
        ]}
      />
    );
  }

  it("picks an option from its label and keeps exactly one checked", async () => {
    const onChange = vi.fn();
    render(<Group onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "Delete it" })).toBeChecked();
    await userEvent.click(screen.getByText("Move it aside"));
    expect(screen.getByRole("radio", { name: "Move it aside" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Delete it" })).not.toBeChecked();
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("moves with the arrow keys", async () => {
    render(<Group />);
    screen.getByRole("radio", { name: "Delete it" }).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "Move it aside" })).toHaveFocus();
  });
});
