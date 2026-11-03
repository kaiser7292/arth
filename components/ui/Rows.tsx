import { View, type ViewProps } from "react-native";
import { drawsOwnDivider, trimEdgeDividers } from "@/utils/row-dividers";

export { drawsOwnDivider, trimEdgeDividers };

/** A box of rows: a View whose lines only go between them. */
export function Rows({ children, ...props }: ViewProps & { className?: string }) {
  return <View {...props}>{trimEdgeDividers(children)}</View>;
}
