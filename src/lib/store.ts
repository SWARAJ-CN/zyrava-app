/**
 * AsyncStorage-backed settings store that mirrors the web app's
 * localStorage / sessionStorage surface. Values live in an in-memory cache
 * hydrated once at boot (before providers mount), so reads stay synchronous
 * exactly like `localStorage.getItem` in the browser. Writes are
 * fire-and-forget persisted under their ORIGINAL web keys.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

type Listener = (key: string, value: string | null) => void;

const cache = new Map<string, string>();
const listeners = new Set<Listener>();
let hydrated = false;
let hydration: Promise<void> | null = null;
const changedBeforeHydration = new Set<string>();

/** Load every persisted key into the cache. Await before rendering the app. */
export function hydrateStorage(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydration) return hydration;
  hydration = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const pairs = await Promise.race([
        (async () => {
          const keys = await AsyncStorage.getAllKeys();
          return keys.length ? await AsyncStorage.multiGet(keys) : [];
        })(),
        new Promise<readonly (readonly [string, string | null])[]>((resolve) => {
          timer = setTimeout(() => resolve([]), 3000);
        }),
      ]);
      for (const [key, value] of pairs) {
        if (typeof value === "string" && !changedBeforeHydration.has(key)) cache.set(key, value);
      }
    } catch {
      // A locked/full/unavailable store must not prevent this session from opening.
    } finally {
      clearTimeout(timer);
      hydrated = true;
      changedBeforeHydration.clear();
    }
  })();
  return hydration;
}

export function getItem(key: string): string | null {
  return cache.get(key) ?? null;
}

export function setItem(key: string, value: string): void {
  if (!hydrated) changedBeforeHydration.add(key);
  cache.set(key, value);
  try {
    void AsyncStorage.setItem(key, value).catch(() => undefined);
  } catch {
    /* memory stays usable */
  }
  for (const listener of listeners) listener(key, value);
}

export function removeItem(key: string): void {
  if (!hydrated) changedBeforeHydration.add(key);
  cache.delete(key);
  try {
    void AsyncStorage.removeItem(key).catch(() => undefined);
  } catch {
    /* memory stays usable */
  }
  for (const listener of listeners) listener(key, null);
}

/** Replaces the browser `window.addEventListener("storage", …)` signal. */
export function onStorageChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** JSON helpers used across the port (same shapes as the web app). */
export function readJson<T>(key: string, fallback: T): T {
  const raw = getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  setItem(key, JSON.stringify(value));
}
