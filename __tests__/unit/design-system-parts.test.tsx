import React from "react";
import { render, fireEvent } from "@testing-library/react-native";

jest.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light", setColorScheme: jest.fn() }),
}));

import { Chip } from "../../components/ui/Chip";
import { CheckRow, RadioRow } from "../../components/ui/OptionRows";
import { Segmented } from "../../components/ui/Segmented";
import { SectionTitle } from "../../components/ui/SectionTitle";
import { ActionRow } from "../../components/ui/ActionRow";
import { FieldRow } from "../../components/ui/FieldRow";
import { SearchField, AMOUNT_SEARCH_PLACEHOLDER } from "../../components/ui/SearchField";
import { moneyTone, toneForTransaction } from "../../components/ui/money-tone";
import { getTheme } from "../../hooks/use-theme";
import { tint } from "../../constants/brand";
import { TYPE, MONEY } from "../../constants/design-tokens";

describe("tokens", () => {
  it("label is the 12px floor", () => {
    expect(TYPE.label[0]).toBe("12px");
  });

  it("spending is ink, not red; red is only over-budget", () => {
    expect(MONEY.out.fg).toBe("foreground");
    expect(MONEY.over.fg).toBe("danger");
    const theme = getTheme("light");
    expect(moneyTone(theme, "out").fg).toBe(theme.foreground);
    expect(moneyTone(theme, "in").fg).toBe(theme.success);
    expect(moneyTone(theme, "moved").fg).toBe(theme.data.transfer);
  });

  it("picks a tone from the transaction", () => {
    expect(toneForTransaction({ nature: "realized" })).toBe("out");
    expect(toneForTransaction({ nature: "credit" })).toBe("in");
    expect(toneForTransaction({ nature: "credit", isTransfer: true })).toBe("moved");
  });

  it("tints hex and channel colours alike", () => {
    expect(tint("#0F766E", 0.1)).toBe("rgba(15, 118, 110, 0.1)");
    expect(tint("#fff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
    expect(tint("15 118 110", 0.1)).toBe("rgba(15, 118, 110, 0.1)");
  });
});

describe("Chip", () => {
  it("toggles and reports its state", () => {
    const onPress = jest.fn();
    const { getByRole } = render(<Chip label="This month" on onPress={onPress} />);
    const chip = getByRole("button");
    expect(chip.props.accessibilityState).toEqual({ selected: true });
    fireEvent.press(chip);
    expect(onPress).toHaveBeenCalled();
  });

  it("removable chips say what they remove", () => {
    const { getByLabelText } = render(<Chip variant="removable" label="UPI" onPress={() => {}} />);
    expect(getByLabelText("Remove UPI")).toBeTruthy();
  });

  it("renders without a press handler as plain text", () => {
    const { getByText, queryByRole } = render(<Chip variant="status" tone="warning" label="Needs review" />);
    expect(getByText("Needs review")).toBeTruthy();
    expect(queryByRole("button")).toBeNull();
  });
});

describe("option rows", () => {
  it("radio and check rows expose checked state", () => {
    const onPress = jest.fn();
    const radio = render(<RadioRow label="Newest first" on onPress={onPress} />);
    expect(radio.getByRole("radio").props.accessibilityState).toEqual({ checked: true });
    fireEvent.press(radio.getByRole("radio"));
    expect(onPress).toHaveBeenCalled();
    const check = render(<CheckRow label="UPI" on={false} onPress={onPress} />);
    expect(check.getByRole("checkbox").props.accessibilityState).toEqual({ checked: false });
  });
});

describe("Segmented", () => {
  it("changes value", () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(
      <Segmented options={[{ value: "", label: "Any" }, { value: "approved", label: "Approved" }]} value="" onChange={onChange} />,
    );
    fireEvent.press(getByLabelText("Approved"));
    expect(onChange).toHaveBeenCalledWith("approved");
  });
});

describe("SectionTitle, ActionRow, FieldRow", () => {
  it("renders a title with its hint", () => {
    const { getByText } = render(<SectionTitle icon="calendar-outline" title="Date" hint="Choose a range" />);
    expect(getByText("Date")).toBeTruthy();
    expect(getByText("Choose a range")).toBeTruthy();
  });

  it("shows at most four actions", () => {
    const items = ["A", "B", "C", "D", "E"].map((k) => ({ key: k, label: k, icon: "add" as const, onPress: jest.fn() }));
    const { queryByText } = render(<ActionRow items={items} />);
    expect(queryByText("D")).toBeTruthy();
    expect(queryByText("E")).toBeNull();
  });

  it("a tappable field row is a button", () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(<FieldRow label="Account" value="Savings ··4821" onPress={onPress} />);
    fireEvent.press(getByLabelText("Account, Savings ··4821"));
    expect(onPress).toHaveBeenCalled();
  });
});

describe("SearchField", () => {
  it("hints the amount search by default", () => {
    const { getByPlaceholderText } = render(<SearchField value="" onChangeText={() => {}} />);
    expect(getByPlaceholderText(AMOUNT_SEARCH_PLACEHOLDER)).toBeTruthy();
    expect(AMOUNT_SEARCH_PLACEHOLDER).toContain(">5000");
  });
});

import { applyLabelFor, iconForFilter } from "../../components/ui/FilterSheetParts";

describe("filter sheet frame", () => {
  it("says how many will show", () => {
    expect(applyLabelFor(24, 2)).toBe("Show 24 transactions");
    expect(applyLabelFor(1, 1)).toBe("Show 1 transaction");
    expect(applyLabelFor(0, 3)).toBe("No transactions match");
    expect(applyLabelFor(null, 0)).toBe("Show all transactions");
    expect(applyLabelFor(null, 2)).toBe("Apply");
    expect(applyLabelFor(5000, 1, { one: "merchant", many: "merchants" })).toBe("Show 5,000 merchants");
  });

  it("guesses a rail icon from the field", () => {
    expect(iconForFilter("date")).toBe("calendar-outline");
    expect(iconForFilter("merchant")).toBe("storefront-outline");
    expect(iconForFilter("xyz")).toBe("funnel-outline");
  });
});
