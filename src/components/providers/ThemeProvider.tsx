import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Appearance } from "react-native";
import { Uniwind, useUniwind } from "uniwind";
import { getItem, onStorageChange, setItem } from "@/lib/store";
import { on as onEvent, emit } from "@/lib/emitter";

/* RN has no SSR: the layout effect is always safe here. */
const useIsomorphicLayoutEffect = useLayoutEffect;

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "music-theme";
const CHANGE_EVENT = "music:theme-change";

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): ThemeMode {
  try {
    const value = getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    /* storage can be unavailable */
  }
  /* Music-first default: the player opens dark, like Spotify. */
  return "dark";
}

/** The scheme the system reports — RN's stand-in for matchMedia(). */
function systemScheme(): "light" | "dark" {
  return Appearance.getColorScheme() === "dark" ? "dark" : "light";
}

/** The theme the palette and this provider keep in sync. */
function apply(mode: ThemeMode, scheme: "light" | "dark") {
  const resolved = mode === "system" ? scheme : mode;
  /* Replaces the web's document.documentElement dataset/class writes: uniwind
     flips every themed style in the tree atomically. */
  Uniwind.setTheme(resolved);
}

function subscribe(onChange: () => void) {
  const appearance = Appearance.addChangeListener(onChange); // was matchMedia change
  const offStorage = onStorageChange(onChange); // was window "storage"
  const offEvent = onEvent(CHANGE_EVENT, onChange); // was window CustomEvent
  return () => {
    appearance.remove();
    offStorage();
    offEvent();
  };
}

/** A single primitive snapshot so React can compare by value. */
function getSnapshot(): string {
  return `${readStored()}|${systemScheme()}`;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const [mode, scheme] = snapshot.split("|") as [ThemeMode, "light" | "dark"];

  /* useUniwind().theme makes this provider re-render the moment the applied
     palette actually flips — the reactive half of the web's DOM mutation. */
  useUniwind();

  useIsomorphicLayoutEffect(() => {
    apply(mode, scheme);
  }, [mode, scheme]);

  const setMode = useCallback((next: ThemeMode) => {
    try {
      setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    emit(CHANGE_EVENT);
  }, []);

  const resolved: "light" | "dark" = mode === "system" ? scheme : mode;

  const toggle = useCallback(() => {
    setMode(resolved === "dark" ? "light" : "dark");
  }, [resolved, setMode]);

  const value = useMemo(
    () => ({ mode, resolved, setMode, toggle }),
    [mode, resolved, setMode, toggle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
