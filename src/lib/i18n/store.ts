import { emit, on } from "../emitter";
import { getItem, setItem } from "../store";
import { DEFAULT_LOCALE, isLocale } from "./locales";

/** Cookie mirror that carries the chosen language to the server on the next load. */
export const LOCALE_COOKIE = "amare_locale";

/** Where the choice is kept on the client. */
const LOCALE_KEY = "amare.locale";

/** Told to whoever wants to know that the language changed. */
const LOCALE_EVENT = "amare:locale";

function fromCookie(): string | null {
  const value = getItem(LOCALE_COOKIE);
  return isLocale(value) ? (value as string) : null;
}

/**
 * The language this app is reading in.
 *
 * The local storage mirror comes first — the cookie mirror is the backup for
 * a launch that has one but not the other, exactly like the web precedence.
 */
export function readLocale(): string {
  try {
    const stored = getItem(LOCALE_KEY);
    if (isLocale(stored)) return stored as string;
  } catch {
    /* storage can be unavailable */
  }
  return fromCookie() ?? DEFAULT_LOCALE;
}

/**
 * Remembers the language on the client and in the cookie mirror.
 *
 * The cookie mirror is what let the server render the page in the right
 * language on the next full load on the web; natively it is kept under the
 * same `amare_locale` key so the choice round-trips identically.
 */
export function writeLocale(code: string): void {
  try {
    setItem(LOCALE_KEY, code);
  } catch {
    /* ignore */
  }
  try {
    setItem(LOCALE_COOKIE, code);
  } catch {
    /* ignore */
  }
}

/** Announces that the language has changed. */
export function announceLocaleChange(): void {
  emit(LOCALE_EVENT);
}

/** Listens for the language changing. */
export function subscribeLocale(onChange: () => void): () => void {
  return on(LOCALE_EVENT, onChange);
}
