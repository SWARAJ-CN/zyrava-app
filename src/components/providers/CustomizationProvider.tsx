import { readJson, writeJson } from "@/lib/store";
import { readWelcome } from "@/lib/customization-welcome";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import { Uniwind } from "uniwind";
import { useAuth } from "./AuthProvider";
import { useTheme } from "./ThemeProvider";
import { apiFetch } from "@/lib/api";
import {
  customizationVariables,
  DEFAULT_CUSTOMIZATION,
  isCustomizationConfig,
  isCustomizationExpired,
  type CustomizationConfig,
  type CustomizationState,
} from "@/lib/customization";

const EMPTY: CustomizationState = { active: null, incoming: [], received: [], outgoing: [] };
const PERSONAL: CustomizationConfig = {
  ...DEFAULT_CUSTOMIZATION,
  title: "Vimitha’s listening room",
  accent: "#e895b5",
  background: "#21131a",
  surface: "#38242a",
  text: "#fff1ed",
  loadingMessage: "Your little world is ready, Baava.",
};
interface ContextValue {
  state: CustomizationState;
  config: CustomizationConfig | null;
  personal: boolean;
  personalTheme: boolean;
  welcome: { config: CustomizationConfig; personal: boolean; identifier: string } | null;
  error: string | null;
  refresh: () => Promise<void>;
  respond: (id: string, accept: boolean, updatedAt: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reset: () => Promise<void>;
}
const Context = createContext<ContextValue | null>(null);

export function CustomizationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const hint = readWelcome(readJson("zyrava:customization-welcome", null));
  const returningPersonal = !user && hint?.personal === true;
  const { resolved } = useTheme();
  const personal = user?.experience === "brown-burgundy";
  const [appearance, setAppearance] = useState(false);
  const [loaded, setLoaded] = useState<{ userId: string; state: CustomizationState } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const identity = useRef(user?.id);
  useLayoutEffect(() => {
    identity.current = user?.id;
    return () => {
      identity.current = undefined;
    };
  }, [user?.id]);
  const state = loaded?.userId === user?.id ? (loaded?.state ?? EMPTY) : EMPTY;
  const refresh = useCallback(async () => {
    if (!user || personal) return;
    try {
      const next = await apiFetch<CustomizationState>("/api/customization");
      if (identity.current !== user.id) return;
      if (
        next.active &&
        (!isCustomizationConfig(next.active.config) || isCustomizationExpired(next.active))
      )
        next.active = null;
      setLoaded({ userId: user.id, state: next });
      setError(null);
    } catch (cause) {
      if (identity.current === user.id)
        setError(cause instanceof Error ? cause.message : "Could not load customizations.");
      throw cause;
    }
  }, [user, personal]);
  useEffect(() => {
    let alive = true;
    const update = async () => {
      if (personal || returningPersonal) {
        try {
          const next = await apiFetch<{ vimithaThemeEnabled: boolean }>("/api/appearance", {
            auth: false,
          });
          if (alive) setAppearance(next.vimithaThemeEnabled === true);
        } catch {
          /* Keep the last confirmed setting until the server returns. */
        }
      } else await refresh().catch(() => undefined);
    };
    void update();
    const timer = setInterval(
      () => {
        if (AppState.currentState === "active") void update();
      },
      personal ? 5000 : 30000
    );
    const listener = AppState.addEventListener("change", (s) => {
      if (s === "active") void update();
    });
    return () => {
      alive = false;
      clearInterval(timer);
      listener.remove();
    };
  }, [personal, refresh, returningPersonal]);
  useEffect(() => {
    if (!state.active?.expiresAt) return;
    const deadline = Date.parse(state.active.expiresAt);
    const expire = () => {
      if (Date.now() >= deadline)
        setLoaded((previous) =>
          previous ? { ...previous, state: { ...previous.state, active: null } } : previous
        );
    };
    const timer = setInterval(expire, 1000);
    expire();
    return () => clearInterval(timer);
  }, [state.active]);
  useEffect(() => {
    if (!user) return;
    if (!personal && loaded?.userId !== user.id) return;
    writeJson("zyrava:customization-welcome", {
      userId: user.id,
      identifier: user.email || user.phone || "",
      personal,
      active: personal ? null : state.active,
    });
  }, [user, personal, loaded, state.active]);
  const personalTheme = personal && appearance;
  const config = personalTheme ? PERSONAL : personal ? null : (state.active?.config ?? null);
  // Restore the exact original palette on logout, expiry, removal and theme switches.
  useEffect(() => {
    if (!config) return;
    const variables = customizationVariables(config);
    const original: Record<string, string | number> = {};
    for (const key of Object.keys(variables)) {
      const value = Uniwind.getCSSVariable(key);
      if (typeof value === "string" || typeof value === "number") original[key] = value;
    }
    Uniwind.updateCSSVariables(resolved, variables);
    return () => Uniwind.updateCSSVariables(resolved, original);
  }, [config, resolved]);
  const mutate = async (path: string, body: unknown) => {
    await apiFetch(`/api/customization/${path}`, { method: "POST", body });
    await refresh();
  };
  const hintConfig = hint?.personal
    ? appearance
      ? PERSONAL
      : null
    : hint?.active && !isCustomizationExpired(hint.active)
      ? hint.active.config
      : null;
  const welcome = config
    ? { config, personal: personalTheme, identifier: user?.email || user?.phone || "" }
    : !user && hintConfig
      ? {
          config: hintConfig,
          personal: hint?.personal ?? false,
          identifier: hint?.identifier || "",
        }
      : null;
  const value = {
    state,
    config,
    personal,
    personalTheme,
    welcome,
    error,
    refresh,
    respond: (id: string, accept: boolean, updatedAt: string) =>
      mutate("respond", { id, accept, updatedAt }),
    remove: (id: string) => mutate("remove", { id }),
    reset: () => mutate("reset", {}),
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useCustomization() {
  const value = useContext(Context);
  if (!value) throw new Error("CustomizationProvider is missing");
  return value;
}
