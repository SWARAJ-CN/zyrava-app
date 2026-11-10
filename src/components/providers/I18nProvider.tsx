import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { translate, type MessageParams } from "@/lib/i18n";
import { isCurated, localeInfo, type LocaleInfo } from "@/lib/i18n/locales";
import {
  announceLocaleChange,
  readLocale,
  subscribeLocale,
  writeLocale,
} from "@/lib/i18n/store";
import { setCurrentLocale } from "@/lib/i18n/current";
import { setFormatLocale } from "@/lib/format";

interface I18nContextValue {
  /** The language the app is reading in. */
  locale: string;
  /** Everything the reader needs to know about that language. */
  info: LocaleInfo;
  /** Switches the language. */
  setLocale: (code: string) => void;
  /** Reads a message in the current language. */
  t: (key: string, params?: MessageParams) => string;
  /** Text direction of the current language. */
  dir: "ltr" | "rtl";
  /** True when the current language reads right-to-left. On the web this was
   *  `document.documentElement.dir`; native consumers read this flag instead,
   *  and the root layout owns the actual RTL flip (LayoutDirection /
   *  I18nManager wiring) — no DOM write happens here. */
  isRTL: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Holds the chosen language for the whole app.
 *
 * On the web the language arrived from the server (a cookie); here it lives in
 * the local store from the first launch, and every effect the web ran against
 * the document now runs against the data layer and this context instead.
 */
export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale?: string;
  children: ReactNode;
}) {
  const locale = useSyncExternalStore(subscribeLocale, readLocale, () =>
    initialLocale ?? readLocale()
  );

  /* Code that is not a React component — the data layer, the invoice — needs
     to know the language too, so it is published as soon as it is known. */
  setCurrentLocale(locale);

  /* Keep the format layer and any listeners in step with the language. */
  const firstRun = useRef(true);
  useEffect(() => {
    const info = localeInfo(locale);
    /* document.documentElement.lang/dir has no native equivalent: `dir` ships
       on the context value (isRTL below) and the root layout applies it. */
    /* Numbers and dates are written the way the language writes them — but a
       language the app has no translation of is still read in English, and an
       Indian shop still counts in lakhs. */
    setFormatLocale(isCurated(locale) ? info.intl : "en-IN");
    /* Anyone who needs to reload the shop's data in the new language is
       listening for this. The first run is not a change, so it is quiet. */
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    announceLocaleChange();
  }, [locale]);

  const setLocale = useCallback((code: string) => {
    writeLocale(code);
    announceLocaleChange();
  }, []);

  const t = useCallback(
    (key: string, params?: MessageParams) => translate(locale, key, params),
    [locale]
  );

  const info = localeInfo(locale);
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      info,
      setLocale,
      t,
      dir: info.dir,
      isRTL: info.dir === "rtl",
    }),
    [locale, info, setLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}

/** Just the translation function, for the many components that need nothing else. */
export function useT(): I18nContextValue["t"] {
  return useI18n().t;
}
