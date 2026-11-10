import { readLocale } from "./store";

/**
 * The language this request asked for.
 *
 * On the web this was read from the request cookie in the server component
 * so the first paint is already in the right language rather than switching
 * to it once the app has hydrated. React Native has no request: the storage shim is
 * hydrated from disk before the providers mount, so the synchronous
 * readLocale() *is* the first-paint locale. The export name is kept so
 * provider imports are unchanged; `await readRequestLocale()` still works.
 */
export function readRequestLocale(): string {
  return readLocale();
}
