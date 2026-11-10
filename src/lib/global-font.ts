/**
 * Global Inter typography — the web's `body { font-family: var(--font-sans) }`
 * (Inter, self-hosted by next/font) expressed for React Native.
 *
 * Neither Uniwind nor heroui-native read a theme font variable, and the
 * project's Inter fonts are static per-weight files, so a single global
 * default is not enough: `font-bold` must land on Inter_700Bold, not on a
 * system-synthesised bold. We therefore wrap the JSX factories once at boot
 * and inject the right family for any Text/TextInput element that did not
 * choose one itself — reading the weight from inline styles AND from Uniwind
 * `font-*` classes, since React Compiler emits jsx() rather than
 * createElement for optimised components.
 */
import { Platform, StyleSheet, Text, TextInput } from "react-native";

const FAMILY_BY_WEIGHT: Record<string, string> = {
  "100": "Inter_100Thin",
  "200": "Inter_200ExtraLight",
  "300": "Inter_300Light",
  "400": "Inter_400Regular",
  "500": "Inter_500Medium",
  "600": "Inter_600SemiBold",
  "700": "Inter_700Bold",
  "800": "Inter_800ExtraBold",
  "900": "Inter_900Black",
};

const CLASS_BY_WEIGHT: Record<string, string> = {
  thin: "100",
  extralight: "200",
  light: "300",
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  extrabold: "800",
  black: "900",
};

type StyleLike = unknown;

/** Flatten style arrays/objects into candidate fontWeight values. */
function weightFromStyle(style: StyleLike): string | null {
  if (!style || typeof style === "number") return null;
  if (Array.isArray(style)) {
    for (const entry of style) {
      const found = weightFromStyle(entry);
      if (found) return found;
    }
    return null;
  }
  if (typeof style === "object" && "fontWeight" in (style as object)) {
    return String((style as { fontWeight?: string | number }).fontWeight ?? "");
  }
  return null;
}

function weightFromClassName(className: unknown): string | null {
  if (typeof className !== "string") return null;
  const match = /\bfont-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/.exec(
    className
  );
  return match ? (CLASS_BY_WEIGHT[match[1]] ?? null) : null;
}

function familyFor(props: Record<string, unknown> | null | undefined): string | null {
  if (!props) return FAMILY_BY_WEIGHT["400"];
  if (typeof props.fontFamily === "string" && props.fontFamily) return null; // caller chose
  const styleFamily =
    props.style && typeof props.style === "object" && !Array.isArray(props.style)
      ? typeof (props.style as { fontFamily?: unknown }).fontFamily === "string"
      : false;
  if (styleFamily) return null;
  const weight =
    weightFromStyle(props.style) ??
    weightFromClassName(props.className) ??
    (typeof props.accessibilityRole === "string" && props.accessibilityRole === "header"
      ? "700"
      : "400");
  return FAMILY_BY_WEIGHT[weight] ?? FAMILY_BY_WEIGHT["400"];
}

/**
 * True for Reanimated 4 AnimatedStyle/AnimatedProps handles (the objects
 * useAnimatedStyle returns): they own `viewDescriptors`/`initial` internals.
 * Those are UI-thread style objects — the components that use them already
 * set `fontFamily` inside their worklet, and touching their shape breaks
 * animation wiring (and expo-router's dev-mode Slot style guard).
 */
function isAnimatedStyleHandle(style: unknown): boolean {
  if (!style || typeof style !== "object") return false;
  if (Array.isArray(style)) return style.some(isAnimatedStyleHandle);
  return (
    "viewDescriptors" in (style as object) ||
    "jestAnimatedValues" in (style as object) ||
    "styleUpdaterContainer" in (style as object)
  );
}

let applied = false;

/**
 * Write helper: React 19 exposes its exports through getters on sealed
 * namespace objects, so `React.createElement = …` throws. The underlying
 * CommonJS `module.exports` objects are plain and writable — require them
 * directly (Metro returns the live exports object) and mutate there. Every
 * step is wrapped so a hostile runtime simply leaves the font unpatched;
 * booting must never depend on this succeeding.
 */
function tryAssign(target: unknown, key: string, value: unknown): boolean {
  try {
    const holder = target as Record<string, unknown>;
    if (Object.isFrozen(holder) || Object.isSealed(holder)) {
      // A sealed/frozen namespace can't even be defineProperty'd — bail.
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(holder, key);
    if (descriptor && !descriptor.configurable && !descriptor.writable) return false;
    holder[key] = value;
    return holder[key] === value;
  } catch {
    return false;
  }
}

/** Patch the JSX factories. Call once, before any screen renders. */
export function applyGlobalFont(): void {
  if (applied || Platform.OS === "web") return; // web resolves Inter via CSS
  applied = true;

  const isTarget = (type: unknown): boolean => type === Text || type === TextInput;

  const wrap = (fn: (type: unknown, props: unknown, ...children: unknown[]) => unknown) =>
    function patched(this: unknown, type: unknown, props: unknown, ...rest: unknown[]) {
      if (isTarget(type)) {
        const currentProps = (props ?? null) as Record<string, unknown> | null;
        const family = familyFor(currentProps);
        if (family && !isAnimatedStyleHandle(currentProps?.style)) {
          const existing = currentProps ?? {};
          props = {
            ...existing,
            // One plain object, not an array — expo-router's dev-time Slot
            // guard (and StyleSheet consumers generally) reject array styles
            // on elements it validates; flatten keeps the same precedence:
            // the component's own style wins over the injected family.
            style: StyleSheet.flatten([{ fontFamily: family }, existing.style as never]),
          };
        }
      }
      return (fn as (...args: unknown[]) => unknown).call(this, type, props, ...rest);
    };

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const reactExports = require("react") as { createElement: unknown };
  const createPatched = tryAssign(reactExports, "createElement", wrap(reactExports.createElement as never));

  // The compiled JSX runtime is what actually runs under reactCompiler.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const jsxRuntime = require("react/jsx-runtime") as {
    jsx: unknown;
    jsxs: unknown;
  };
  const jsxPatched = tryAssign(jsxRuntime, "jsx", wrap(jsxRuntime.jsx as never));
  const jsxsPatched = tryAssign(jsxRuntime, "jsxs", wrap(jsxRuntime.jsxs as never));

  // One line of truth in the Metro log about whether Inter took effect.
  console.info(
    `[zyrava] global font patch: createElement=${createPatched} jsx=${jsxPatched} jsxs=${jsxsPatched}`
  );
}
