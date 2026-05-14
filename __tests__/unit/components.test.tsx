import React from "react";
import { render, fireEvent } from "@testing-library/react-native";

// Mock nativewind to prevent "Unable to manually set color scheme" error in tests
jest.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light", setColorScheme: jest.fn() }),
}));

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { ScreenContainer } from "../../components/ui/ScreenContainer";
import { Text } from "react-native";

describe("Button", () => {
  it("renders title text", () => {
    const { getByText } = render(
      <Button title="Save" onPress={() => {}} />,
    );
    expect(getByText("Save")).toBeTruthy();
  });

  it("calls onPress when pressed", () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <Button title="Save" onPress={onPress} />,
    );
    fireEvent.press(getByText("Save"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not call onPress when disabled", () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <Button title="Save" onPress={onPress} disabled />,
    );
    fireEvent.press(getByText("Save"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("shows loading indicator when loading", () => {
    const { queryByText } = render(
      <Button title="Save" onPress={() => {}} loading />,
    );
    // Title should not be visible when loading
    expect(queryByText("Save")).toBeNull();
  });
});

describe("Card", () => {
  it("renders children", () => {
    const { getByText } = render(
      <Card>
        <Text>Card content</Text>
      </Card>,
    );
    expect(getByText("Card content")).toBeTruthy();
  });

  it("renders title when provided", () => {
    const { getByText } = render(
      <Card title="Summary">
        <Text>Content</Text>
      </Card>,
    );
    expect(getByText("Summary")).toBeTruthy();
    expect(getByText("Content")).toBeTruthy();
  });
});

describe("Input", () => {
  it("renders with label", () => {
    const { getByText } = render(<Input label="Amount" />);
    expect(getByText("Amount")).toBeTruthy();
  });

  it("shows error message", () => {
    const { getByText } = render(
      <Input label="Amount" error="Required field" />,
    );
    expect(getByText("Required field")).toBeTruthy();
  });

  it("accepts text input", () => {
    const onChange = jest.fn();
    const { getByDisplayValue } = render(
      <Input value="500" onChangeText={onChange} />,
    );
    expect(getByDisplayValue("500")).toBeTruthy();
  });
});

describe("ScreenContainer", () => {
  it("renders children", () => {
    const { getByText } = render(
      <ScreenContainer>
        <Text>Screen content</Text>
      </ScreenContainer>,
    );
    expect(getByText("Screen content")).toBeTruthy();
  });
});
