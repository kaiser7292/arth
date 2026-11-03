import { settingsStorage } from "./storage";

/** Each list remembers how it was last grouped. */
const PREFIX = "group_by__";

export function getGroupByPreference(screen: string): string | undefined {
  return settingsStorage.getString(PREFIX + screen);
}

export function setGroupByPreference(screen: string, groupBy: string): void {
  const key = PREFIX + screen;
  settingsStorage.set(key, groupBy);
}
