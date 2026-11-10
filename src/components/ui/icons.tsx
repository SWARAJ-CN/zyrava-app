/**
 * Icon configuration — the single source of truth for every icon in the app.
 *
 * All icons are the Feather set: 24×24 grid, 2px round stroke, drawn with the
 * theme's foreground (or contextual text) colour so each one inherits the text
 * colour of the context it sits in. The path data is copied verbatim from the
 * web `components/ui/icons.tsx`; only the renderer is react-native-svg.
 *
 * Usage: <Icon name="play" size={18} fill="currentColor" className="fill-current text-white" />
 *
 * `className` is parsed for the utilities the web relied on (`text-*`,
 * `fill-*`, `size-N`) because react-native-svg cannot be styled by Uniwind —
 * the resolved values are passed to the SVG's stroke/fill/width props instead.
 */
import { type ReactNode } from "react";
import { type StyleProp, type ViewStyle, View } from "react-native";
import { useButton, type ButtonVariant as HeroButtonVariant } from "heroui-native";
import Svg, { Circle, Line, Path, Polygon, Polyline, Rect } from "react-native-svg";
import { useCSSVariable } from "uniwind";

export const ICONS = {
  search: (
    <>
      <Circle cx="11" cy="11" r="8" />
      <Line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  music: (
    <>
      <Path d="M9 18V5l12-2v13" />
      <Circle cx="6" cy="18" r="3" />
      <Circle cx="18" cy="16" r="3" />
    </>
  ),
  play: <Polygon points="5 3 19 12 5 21 5 3" />,
  pause: (
    <>
      <Rect x="6" y="4" width="4" height="16" />
      <Rect x="14" y="4" width="4" height="16" />
    </>
  ),
  "skip-back": (
    <>
      <Polygon points="19 20 9 12 19 4 19 20" />
      <Line x1="5" y1="19" x2="5" y2="5" />
    </>
  ),
  "skip-forward": (
    <>
      <Polygon points="5 4 15 12 5 20 5 4" />
      <Line x1="19" y1="5" x2="19" y2="19" />
    </>
  ),
  sliders: (
    <>
      <Line x1="4" y1="21" x2="4" y2="14" />
      <Line x1="4" y1="10" x2="4" y2="3" />
      <Line x1="12" y1="21" x2="12" y2="12" />
      <Line x1="12" y1="8" x2="12" y2="3" />
      <Line x1="20" y1="21" x2="20" y2="16" />
      <Line x1="20" y1="12" x2="20" y2="3" />
      <Line x1="1" y1="14" x2="7" y2="14" />
      <Line x1="9" y1="8" x2="15" y2="8" />
      <Line x1="17" y1="16" x2="23" y2="16" />
    </>
  ),
  list: (
    <>
      <Line x1="8" y1="6" x2="21" y2="6" />
      <Line x1="8" y1="12" x2="21" y2="12" />
      <Line x1="8" y1="18" x2="21" y2="18" />
      <Line x1="3" y1="6" x2="3.01" y2="6" />
      <Line x1="3" y1="12" x2="3.01" y2="12" />
      <Line x1="3" y1="18" x2="3.01" y2="18" />
    </>
  ),
  menu: (
    <>
      <Line x1="3" y1="6" x2="21" y2="6" />
      <Line x1="3" y1="12" x2="21" y2="12" />
      <Line x1="3" y1="18" x2="21" y2="18" />
    </>
  ),
  grid: (
    <>
      <Rect x="3" y="3" width="7" height="7" />
      <Rect x="14" y="3" width="7" height="7" />
      <Rect x="14" y="14" width="7" height="7" />
      <Rect x="3" y="14" width="7" height="7" />
    </>
  ),
  image: (
    <>
      <Rect x="3" y="3" width="18" height="18" rx="2" />
      <Circle cx="8.5" cy="8.5" r="1.5" />
      <Polyline points="21 15 16 10 5 21" />
    </>
  ),
  globe: (
    <>
      <Circle cx="12" cy="12" r="10" />
      <Line x1="2" y1="12" x2="22" y2="12" />
      <Path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </>
  ),
  "chevron-left": <Polyline points="15 18 9 12 15 6" />,
  "chevron-right": <Polyline points="9 18 15 12 9 6" />,
  "volume-2": (
    <>
      <Polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <Path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <Path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </>
  ),
  "volume-x": (
    <>
      <Polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <Line x1="23" y1="9" x2="17" y2="15" />
      <Line x1="17" y1="9" x2="23" y2="15" />
    </>
  ),
  "alert-triangle": (
    <>
      <Path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <Line x1="12" y1="9" x2="12" y2="13" />
      <Line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  "check-circle": (
    <>
      <Path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <Polyline points="22 4 12 14.01 9 11.01" />
    </>
  ),
  info: (
    <>
      <Circle cx="12" cy="12" r="10" />
      <Line x1="12" y1="16" x2="12" y2="12" />
      <Line x1="12" y1="8" x2="12.01" y2="8" />
    </>
  ),
  "x-circle": (
    <>
      <Circle cx="12" cy="12" r="10" />
      <Line x1="15" y1="9" x2="9" y2="15" />
      <Line x1="9" y1="9" x2="15" y2="15" />
    </>
  ),
  "external-link": (
    <>
      <Path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <Polyline points="15 3 21 3 21 9" />
      <Line x1="10" y1="14" x2="21" y2="3" />
    </>
  ),
  clock: (
    <>
      <Circle cx="12" cy="12" r="10" />
      <Polyline points="12 6 12 12 16 14" />
    </>
  ),
  heart: (
    <Path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  ),
  loader: (
    <>
      <Line x1="12" y1="2" x2="12" y2="6" />
      <Line x1="12" y1="18" x2="12" y2="22" />
      <Line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
      <Line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <Line x1="2" y1="12" x2="6" y2="12" />
      <Line x1="18" y1="12" x2="22" y2="12" />
      <Line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
      <Line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </>
  ),
  sidebar: (
    <>
      <Rect x="3" y="3" width="18" height="18" rx="2" />
      <Line x1="15" y1="3" x2="15" y2="21" />
    </>
  ),
  check: <Polyline points="20 6 9 17 4 12" />,
  sun: (
    <>
      <Circle cx="12" cy="12" r="5" />
      <Line x1="12" y1="1" x2="12" y2="3" />
      <Line x1="12" y1="21" x2="12" y2="23" />
      <Line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <Line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <Line x1="1" y1="12" x2="3" y2="12" />
      <Line x1="21" y1="12" x2="23" y2="12" />
      <Line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <Line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </>
  ),
  moon: <Path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  activity: <Polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  gauge: (
    <>
      <Path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <Path d="M5.5 18.5a9 9 0 1 1 13 0" />
    </>
  ),
  x: (
    <>
      <Line x1="18" y1="6" x2="6" y2="18" />
      <Line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  plus: (
    <>
      <Line x1="12" y1="5" x2="12" y2="19" />
      <Line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  trash: (
    <>
      <Polyline points="3 6 5 6 21 6" />
      <Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  shuffle: (
    <>
      <Polyline points="16 3 21 3 21 8" />
      <Line x1="4" y1="20" x2="21" y2="3" />
      <Polyline points="21 16 21 21 16 21" />
      <Line x1="15" y1="15" x2="21" y2="21" />
      <Line x1="4" y1="4" x2="9" y2="9" />
    </>
  ),
  refresh: (
    <>
      <Polyline points="23 4 23 10 17 10" />
      <Path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </>
  ),
  repeat: (
    <>
      <Polyline points="17 1 21 5 17 9" />
      <Path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <Polyline points="7 23 3 19 7 15" />
      <Path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </>
  ),
  square: <Rect x="5" y="5" width="14" height="14" rx="1" />,
  zap: <Polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  mic: (
    <>
      <Path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <Path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <Line x1="12" y1="18" x2="12" y2="22" />
      <Line x1="8" y1="22" x2="16" y2="22" />
    </>
  ),
  audioLines: (
    <>
      <Line x1="3" y1="10" x2="3" y2="14" />
      <Line x1="7.5" y1="7" x2="7.5" y2="17" />
      <Line x1="12" y1="4" x2="12" y2="20" />
      <Line x1="16.5" y1="7" x2="16.5" y2="17" />
      <Line x1="21" y1="10" x2="21" y2="14" />
    </>
  ),
  sparkles: (
    <>
      <Path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
      <Path d="M19 14l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9L19 14z" />
    </>
  ),
  bell: (
    <>
      <Path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <Path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </>
  ),
  wind: (
    <>
      <Path d="M9.59 4.59A2 2 0 1 1 11 8H2" />
      <Path d="M17.73 7.73A2.5 2.5 0 1 1 19.5 12H2" />
      <Path d="M12.59 19.41A2 2 0 1 0 14 16H2" />
    </>
  ),
  radio: (
    <>
      <Circle cx="12" cy="12" r="2" />
      <Path d="M4.93 19.07a10 10 0 0 1 0-14.14 10 10 0 0 1 14.14 0 10 10 0 0 1 0 14.14 10 10 0 0 1-14.14 0" />
      <Path d="M7.76 16.24a6 6 0 0 1 0-8.48 6 6 0 0 1 8.48 0 6 6 0 0 1 0 8.48 6 6 0 0 1-8.48 0" />
    </>
  ),
  waves: (
    <>
      <Path d="M2 6c.9.6 1.9 1 3 1s2.1-.4 3-1 1.9-1 3-1 2.1.4 3 1 1.9 1 3 1 2.1-.4 3-1" />
      <Path d="M2 12c.9.6 1.9 1 3 1s2.1-.4 3-1 1.9-1 3-1 2.1.4 3 1 1.9 1 3 1 2.1-.4 3-1" />
      <Path d="M2 18c.9.6 1.9 1 3 1s2.1-.4 3-1 1.9-1 3-1 2.1.4 3 1 1.9 1 3 1 2.1-.4 3-1" />
    </>
  ),
  "volume-1": (
    <>
      <Polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <Path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </>
  ),
  user: (
    <>
      <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <Circle cx="12" cy="7" r="4" />
    </>
  ),
  "log-out": (
    <>
      <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <Polyline points="16 17 21 12 16 7" />
      <Line x1="21" y1="12" x2="9" y2="12" />
    </>
  ),
  download: (
    <>
      <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <Polyline points="7 10 12 15 17 10" />
      <Line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  message: <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  send: (
    <>
      <Line x1="22" y1="2" x2="11" y2="13" />
      <Polygon points="22 2 15 22 11 13 2 9 22 2" />
    </>
  ),
  share: (
    <>
      <Path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      <Polyline points="8 8 12 4 16 8" />
      <Line x1="12" y1="4" x2="12" y2="15" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

/** The label-colour token each HeroUI button variant paints its contents with. */
const BUTTON_LABEL_TOKEN: Record<HeroButtonVariant, string> = {
  primary: "--color-accent-foreground",
  secondary: "--color-accent-soft-foreground",
  tertiary: "--color-default-foreground",
  outline: "--color-default-foreground",
  ghost: "--color-default-foreground",
  danger: "--color-danger-foreground",
  "danger-soft": "--color-danger-soft-foreground",
};

const LITERAL_COLORS: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
};

/** First resolved (non-empty) value among the given CSS variable names. */
export function useVarColor(names: string[]): string | undefined {
  const values = useCSSVariable(names);
  const list = Array.isArray(values) ? values : [values];
  for (const value of list) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

type ColorSource = { varName?: string; literal?: string };

/** `var(--foo)` / `--foo` → candidate CSS variable names; anything else is a literal. */
function colorSource(input: string): ColorSource {
  const match = /^var\((.+)\)$/.exec(input.trim());
  const raw = (match ? match[1] : input).trim();
  if (!raw.startsWith("--")) return { literal: LITERAL_COLORS[raw] ?? raw };
  const bare = raw.replace(/^--/, "").replace(/^color-/, "");
  return { varName: `--color-${bare}` };
}

/** Class token (`text-muted`, `fill-brand`) → a source; `white`/`black` are literals. */
function tokenSource(token: string): ColorSource {
  const literal = LITERAL_COLORS[token];
  return literal ? { literal } : { varName: `--color-${token}` };
}

/** Resolves each source in priority order and returns the first usable colour. */
function useResolvedSources(sources: ColorSource[]): string {
  // The hook runs for every source so the call order stays stable and the
  // returned array stays index-aligned with `sources`; unresolvable slots
  // return undefined and the scan moves on to the next source.
  const raw = useCSSVariable(sources.map((source) => source.varName ?? "--color-foreground"));
  const values = Array.isArray(raw) ? raw : [raw];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    if (source.literal) return source.literal;
    const value = values[index];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "#ffffff";
}

/** Resolve one colour (`#hex`, `white`, `var(--brand)`, `--color-x`) for SVG usage. */
export function useSourceColor(input: string): string {
  return useResolvedSources([colorSource(input)]);
}

/** `white`/`black` literals need a var slot even though the literal wins. */
const LITERAL_VAR = "--color-foreground";

/**
 * Resolves a colour from (in priority order) an explicit `color` prop, a
 * `text-*` class, a `white`/`black` literal, and finally the theme foreground.
 */
export function useClassColor(
  className?: string,
  explicit?: string,
  fallbackVar = LITERAL_VAR
): string {
  return useResolvedSources(buildColorSources(className, explicit, fallbackVar));
}

/** Ordered colour sources for a component: explicit prop, `text-*`, fallback. */
export function buildColorSources(
  className?: string,
  explicit?: string,
  fallbackVar = LITERAL_VAR
): ColorSource[] {
  const sources: ColorSource[] = [];
  if (explicit) sources.push(colorSource(explicit));
  const textToken = /(?:^|\s)text-([\w-]+)/i.exec(className ?? "")?.[1];
  if (textToken) sources.push(tokenSource(textToken));
  sources.push({ varName: fallbackVar });
  return sources;
}

/** Reads the button variant context; safe outside a Button (returns undefined). */
function useButtonVariant(): HeroButtonVariant | undefined {
  try {
    // useButton() consumes exactly one context slot before it throws, so the
    // hook order stays stable whether or not we are inside a Button.
    return useButton().variant;
  } catch {
    return undefined;
  }
}

/** `size-N` utility → pixel value (N quarters of a rem, rem = 16px). */
export function sizeFromClassName(className?: string): number | undefined {
  const match = /(?:^|\s)size-([\d.]+)(?=\s|$)/.exec(className ?? "");
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  // Tailwind's spacing scale is 0.25rem per unit, so `size-4` is 1rem = 16px,
  // `size-3.5` is 14px, `size-12` is 48px. (Multiplying by 16 here made every
  // icon four times too large — the "icons are too big" report.)
  return Number.isFinite(value) ? value * 4 : undefined;
}

/** `opacity-N` utility (Tailwind 0–100 scale) → 0–1 fraction. */
export function opacityFromClassName(className?: string): number | undefined {
  const match = /(?:^|\s)opacity-(\d{1,3})(?=\s|$)/.exec(className ?? "");
  if (!match) return undefined;
  return Math.min(1, Number.parseInt(match[1], 10) / 100);
}

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  /** Stroke colour — a raw color, a token (`"white"`), or a `var(--x)` reference. */
  color?: string;
  /** Optional fill (feather icons are stroked by default; `play`/`zap` get `fill-current`). */
  fill?: string;
  /** Parsed for `text-*`, `fill-*` and `size-N` so web call sites keep their look. */
  className?: string;
  style?: StyleProp<ViewStyle>;
}

export function Icon({
  name,
  size = 20,
  strokeWidth = 2,
  color,
  fill,
  className,
  style,
}: IconProps): ReactNode {
  const variant = useButtonVariant();
  const resolvedSize = sizeFromClassName(className) ?? size;

  const stroke = useClassColor(
    className,
    color,
    variant ? BUTTON_LABEL_TOKEN[variant] : "--color-foreground"
  );

  const fillToken = /(?:^|\s)fill-([\w-]+)/i.exec(className ?? "")?.[1];
  let fillValue: string | undefined = fill;
  if (fillToken === "current") fillValue = stroke;
  else if (fillToken) {
    const literal = LITERAL_COLORS[fillToken];
    fillValue = literal ?? undefined;
  }

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[{ width: resolvedSize, height: resolvedSize }, style]}
    >
      <Svg
        width={resolvedSize}
        height={resolvedSize}
        viewBox="0 0 24 24"
        fill={fillValue ?? "none"}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICONS[name]}
      </Svg>
    </View>
  );
}
