import { LinearGradient } from "expo-linear-gradient";
import type { JSX } from "react";
import type { StyleProp, ViewStyle } from "react-native";

/* ------------------------------------------------------------------ *
 * The web sheets paint their artwork scrims with Tailwind gradient
 * utilities (`bg-gradient-to-t from-black/70 …`). To keep them pixel-
 * honest on device, every scrim is painted with expo-linear-gradient
 * from the same stops instead of relying on CSS gradient compilation.
 * ------------------------------------------------------------------ */

const DIRECTIONS = {
  up: { start: { x: 0.5, y: 1 }, end: { x: 0.5, y: 0 } },
  down: { start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 } },
  right: { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
} as const;

export function Scrim({
  colors,
  direction = "up",
  className,
  style,
}: {
  /** CSS-ordered stops (bottom→top for "up"), e.g. ["rgba(0,0,0,0.7)", "transparent"]. */
  colors: readonly [string, string, ...string[]];
  direction?: keyof typeof DIRECTIONS;
  className?: string;
  style?: StyleProp<ViewStyle>;
}): JSX.Element {
  const { start, end } = DIRECTIONS[direction];
  return (
    <LinearGradient
      className={className}
      colors={colors}
      start={start}
      end={end}
      pointerEvents="none"
      style={style}
    />
  );
}

/** The app's stock artwork washes, from the web's own stop values. */
export const SCRIM_STOPS = {
  /** from-black/70 via-black/10 to-transparent */
  tile: ["rgba(0,0,0,0.7)", "rgba(0,0,0,0.1)", "rgba(0,0,0,0)"] as const,
  /** from-black/70 via-transparent to-transparent */
  tileSoft: ["rgba(0,0,0,0.7)", "rgba(0,0,0,0)", "rgba(0,0,0,0)"] as const,
  /** from-black/85 via-black/25 to-transparent (region rail cards) */
  rail: ["rgba(0,0,0,0.85)", "rgba(0,0,0,0.25)", "rgba(0,0,0,0)"] as const,
  /** to-r from-black/85 via-black/55 to-black/20 (region carousel panel) */
  hero: ["rgba(0,0,0,0.85)", "rgba(0,0,0,0.55)", "rgba(0,0,0,0.2)"] as const,
};
