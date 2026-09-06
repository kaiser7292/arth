/**
 * Web stand-in for the MMKV stores.
 *
 * Metro resolves `.web.ts` ahead of `.ts` for the web platform, so this file is what the preview
 * harness gets and it is NEVER part of an Android bundle - the real storage.ts is untouched.
 *
 * It exists because storage.ts constructs MMKV at module scope. MMKV is a JSI module with no web
 * implementation, so that throws the moment anything imports it - and `hooks/use-color-scheme`
 * imports it, which means practically every component in the app was unrenderable outside a
 * device. That is the single reason the design system could not be looked at without a build.
 *
 * Backed by localStorage so a theme toggle survives a reload, with an in-memory fallback for
 * contexts where localStorage is unavailable. It implements only the surface the app actually
 * uses; anything missing should fail loudly here rather than silently differ from the device.
 */
type Listener = () => void;

class WebStore {
  private readonly prefix: string;
  private readonly memory = new Map<string, string>();
  private readonly listeners = new Set<Listener>();

  constructor(id: string) {
    this.prefix = `${id}:`;
  }

  private read(key: string): string | undefined {
    try {
      const v = window.localStorage.getItem(this.prefix + key);
      return v === null ? undefined : v;
    } catch {
      return this.memory.get(key);
    }
  }

  private write(key: string, value: string): void {
    try {
      window.localStorage.setItem(this.prefix + key, value);
    } catch {
      this.memory.set(key, value);
    }
    this.listeners.forEach((l) => l());
  }

  getString(key: string): string | undefined {
    return this.read(key);
  }

  getNumber(key: string): number | undefined {
    const v = this.read(key);
    return v === undefined ? undefined : Number(v);
  }

  getBoolean(key: string): boolean | undefined {
    const v = this.read(key);
    return v === undefined ? undefined : v === "true";
  }

  set(key: string, value: string | number | boolean): void {
    this.write(key, String(value));
  }

  contains(key: string): boolean {
    return this.read(key) !== undefined;
  }

  delete(key: string): void {
    try {
      window.localStorage.removeItem(this.prefix + key);
    } catch {
      this.memory.delete(key);
    }
    this.listeners.forEach((l) => l());
  }

  getAllKeys(): string[] {
    try {
      return Object.keys(window.localStorage)
        .filter((k) => k.startsWith(this.prefix))
        .map((k) => k.slice(this.prefix.length));
    } catch {
      return [...this.memory.keys()];
    }
  }

  clearAll(): void {
    this.getAllKeys().forEach((k) => this.delete(k));
  }

  addOnValueChangedListener(cb: (key: string) => void) {
    const l = () => cb("");
    this.listeners.add(l);
    return { remove: () => this.listeners.delete(l) };
  }
}

export const settingsStorage = new WebStore("artha-settings") as unknown as typeof import("./storage").settingsStorage;
export const duplicateDismissalsStorage = new WebStore("artha-duplicate-dismissals") as unknown as typeof import("./storage").duplicateDismissalsStorage;
export const minBalanceAcksStorage = new WebStore("artha-min-balance-acks") as unknown as typeof import("./storage").minBalanceAcksStorage;
