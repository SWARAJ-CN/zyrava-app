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

/** Load every persisted key into the cache. Await before rendering the app. */
export async function hydrateStorage(): Promise<void> {
  if (hydrated) return;
  const keys = await AsyncStorage.getAllKeys();
  if (keys.length > 0) {
    const pairs = await AsyncStorage.multiGet(keys);
    for (const [key, value] of pairs) {
      if (value !== null) cache.set(key, value);
    }
  }
  hydrated = true;
}

export function getItem(key: string): string | null {
  return cache.get(key) ?? null;
}

export function setItem(key: string, value: string): void {
  cache.set(key, value);
  void AsyncStorage.setItem(key, value);
  for (const listener of listeners) listener(key, value);
}

export function removeItem(key: string): void {
  cache.delete(key);
  void AsyncStorage.removeItem(key);
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
