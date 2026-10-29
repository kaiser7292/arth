import { requireOptionalNativeModule } from "expo-modules-core";

const Native = requireOptionalNativeModule<{
  installerPackage(): string | null;
  playUpdate(): Promise<number | null>;
  startPlayUpdate(): Promise<boolean>;
}>("ArthAppUpdates");

/** Android only, and only in a build with the native module. */
export const isAppUpdatesAvailable = Native != null;

/** The app that installed Arth: "com.android.vending" for the Play Store; null for an APK. */
export function installerPackage(): string | null {
  try {
    return Native?.installerPackage() ?? null;
  } catch {
    return null;
  }
}

/** The version code Play has, when it's newer than this one; null otherwise. */
export async function playUpdate(): Promise<number | null> {
  if (!Native) return null;
  try {
    return await Native.playUpdate();
  } catch {
    return null;
  }
}

/** Opens Play's update screen. False when there's nothing to update to. */
export async function startPlayUpdate(): Promise<boolean> {
  if (!Native) return false;
  try {
    return await Native.startPlayUpdate();
  } catch {
    return false;
  }
}
