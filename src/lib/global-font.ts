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
import { Platform, Text, TextInput } from "react-native";
import * as React from "react";

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

let applied = false;

/** Patch the JSX factories. Call once, before any screen renders. */
export function applyGlobalFont(): void {
  if (applied || Platform.OS === "web") return; // web resolves Inter via CSS
  applied = true;

  const isTarget = (type: unknown): boolean => type === Text || type === TextInput;

  const wrap = (fn: (type: unknown, props: unknown, ...children: unknown[]) => unknown) =>
    function patched(this: unknown, type: unknown, props: unknown, ...rest: unknown[]) {
      if (isTarget(type)) {
        const family = familyFor(props as Record<string, unknown> | null);
        if (family) {
          const existing = (props ?? {}) as Record<string, unknown>;
          props = {
            ...existing,
            style: [{ fontFamily: family }, existing.style].filter(Boolean),
          };
        }
      }
      return (fn as (...args: unknown[]) => unknown).call(this, type, props, ...rest);
    };

  const createElementOriginal = React.createElement as unknown as (
    type: unknown,
    props: unknown,
    ...children: unknown[]
  ) => unknown;
  (React as unknown as Record<string, unknown>).createElement = wrap(createElementOriginal);

  // The compiled JSX runtime is what actually runs under reactCompiler.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const jsxRuntime = require("react/jsx-runtime") as {
    jsx: unknown;
    jsxs: unknown;
  };
  jsxRuntime.jsx = wrap(jsxRuntime.jsx as (...args: unknown[]) => unknown);
  jsxRuntime.jsxs = wrap(jsxRuntime.jsxs as (...args: unknown[]) => unknown);
}
