import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

jest.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light", setColorScheme: jest.fn() }),
}));

import { Input } from "../../components/ui/Input";

/** A form like the app's: holds what the box hands it, and can be reset from outside. */
function Form({ initial = "", onValue }: { initial?: string; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  onValue?.(value);
  return (
    <>
      <Input formula label="Amount" value={value} onChangeText={setValue} />
      <Input label="Reset" onFocus={() => setValue("")} />
    </>
  );
}

const box = () => screen.getByLabelText("Amount");

describe("Input with formula", () => {
  it("hands the form the number while showing the expression, so Save works with the keyboard up", () => {
    let held = "";
    render(<Form onValue={(v) => (held = v)} />);
    fireEvent(box(), "focus");
    fireEvent.changeText(box(), "=5000+2500*2");
    expect(held).toBe("10000");
    expect(box().props.value).toBe("=5000+2500*2");
  });

  it("an expression that doesn't work out yet gives the form nothing, not an old answer", () => {
    let held = "";
    render(<Form onValue={(v) => (held = v)} />);
    fireEvent(box(), "focus");
    fireEvent.changeText(box(), "=5000");
    expect(held).toBe("5000");
    fireEvent.changeText(box(), "=5000+");
    expect(held).toBe("");
    expect(box().props.value).toBe("=5000+");
  });

  it("leaving the box replaces the expression with the number", () => {
    render(<Form />);
    fireEvent(box(), "focus");
    fireEvent.changeText(box(), "=100/4");
    fireEvent(box(), "blur");
    expect(box().props.value).toBe("25");
  });

  it("plain numbers pass straight through", () => {
    let held = "";
    render(<Form onValue={(v) => (held = v)} />);
    fireEvent.changeText(box(), "450");
    expect(held).toBe("450");
    expect(box().props.value).toBe("450");
  });

  it("a saved '=...' from the form is worked out on leaving", () => {
    let held = "";
    render(<Form initial="=2+2" onValue={(v) => (held = v)} />);
    fireEvent(box(), "blur");
    expect(held).toBe("4");
  });

  it("a reset from the form wins once out of the box", () => {
    let held = "x";
    render(<Form onValue={(v) => (held = v)} />);
    fireEvent(box(), "focus");
    fireEvent.changeText(box(), "=1+");
    fireEvent(box(), "blur");
    expect(box().props.value).toBe("=1+");
    fireEvent(screen.getByLabelText("Reset"), "focus");
    expect(held).toBe("");
  });
});
