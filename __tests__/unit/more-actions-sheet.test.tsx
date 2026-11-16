import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";

jest.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light", setColorScheme: jest.fn() }),
}));
jest.mock("@/components/ui/Sheet", () => {
  const { View } = jest.requireActual("react-native");
  return { Sheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => (visible ? <View>{children}</View> : null) };
});

import { MoreActionsSheet } from "../../components/expense/MoreActionsSheet";

describe("MoreActionsSheet", () => {
  it("shows only groups with something in them, and runs an action after closing", () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    const onDuplicate = jest.fn();
    const { getByText, queryByText } = render(
      <MoreActionsSheet
        visible
        onClose={onClose}
        groups={[
          { key: "moved", title: "Money moved", icon: "swap-horizontal-outline", items: [] },
          { key: "copy", title: "Copy and remove", icon: "copy-outline", items: [{ key: "dup", label: "Duplicate", hint: "Start a new one", icon: "copy-outline", onPress: onDuplicate }] },
        ]}
      />,
    );
    expect(queryByText("Money moved")).toBeNull();
    fireEvent.press(getByText("Duplicate"));
    expect(onClose).toHaveBeenCalled();
    expect(onDuplicate).not.toHaveBeenCalled();
    act(() => {
      jest.runAllTimers();
    });
    expect(onDuplicate).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
