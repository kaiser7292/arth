import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

/**
 * The household invite scanner, kept apart from the Join screen so a build without the camera
 * module (an iPhone build made before expo-camera was added, without a clean prebuild) can't crash
 * the screen: the module is loaded only here, inside a try, and without it the screen falls back to
 * pasting the invite link.
 */
let camera: typeof import("expo-camera") | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded inside a try on purpose (see above)
  camera = require("expo-camera") as typeof import("expo-camera");
} catch {
  camera = null;
}

export const scannerAvailable = () => camera != null;

interface Props {
  onScanned: (data: string) => void;
}

export function QrScanner({ onScanned }: Props) {
  if (!camera) return <ScannerUnavailable />;
  return <Scanner onScanned={onScanned} />;
}

function Scanner({ onScanned }: Props) {
  const theme = useTheme();
  const cam = camera as typeof import("expo-camera");
  const [permission, requestPermission] = cam.useCameraPermissions();
  if (permission?.granted) {
    const CameraView = cam.CameraView;
    return (
      <View style={{ borderRadius: 16, overflow: "hidden", aspectRatio: 1 }}>
        <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={(r) => onScanned(r.data)} />
      </View>
    );
  }
  return (
    <Card>
      <View className="items-center py-4">
        <Ionicons name="qr-code-outline" size={40} color={theme.primary} />
        <Text className="text-sm text-foreground mt-3 text-center">Arth uses the camera only to scan the invite code.</Text>
        <Button title="Scan the code" className="mt-4 self-stretch" onPress={() => void requestPermission()} />
      </View>
    </Card>
  );
}

function ScannerUnavailable() {
  const theme = useTheme();
  return (
    <Card>
      <View className="items-center py-4">
        <Ionicons name="link-outline" size={36} color={theme.primary} />
        <Text className="text-sm text-foreground mt-3 text-center">
          Scanning isn&apos;t available in this build. Ask for the invite link instead, copy it, and paste it below.
        </Text>
      </View>
    </Card>
  );
}
