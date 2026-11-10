import { useId } from "react";
import { type StyleProp, type ViewStyle, View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { areaPath, smoothPath, type Point } from "./chart-utils";

/** `size-N` / `w-N` / `h-N` utilities → pixels (N quarters of a rem, rem = 16px). */
function classDim(className: string | undefined, key: "size" | "w" | "h"): number | undefined {
  const match = new RegExp(`(?:^|\\s)${key}-(\\d+(?:\\.\\d+)?)(?=\\s|$)`).exec(className ?? "");
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value * 16 : undefined;
}

/** Tailwind `opacity-N` → 0–1. */
function classOpacity(className: string | undefined): number | undefined {
  const match = /(?:^|\s)opacity-(\d{1,3})(?=\s|$)/.exec(className ?? "");
  return match ? Math.min(1, Number.parseInt(match[1], 10) / 100) : undefined;
}

interface SparklineProps {
  values: number[];
  /** A raw color or a `var(--x)` token reference — resolved through Uniwind. */
  color?: string;
  className?: string;
  width?: number;
  height?: number;
}

/** Resolves `var(--brand)`-style references to real colors for the SVG layer. */
function useSeriesColor(color: string): string {
  const match = /^var\((--[\w-]+)\)$/.exec(color.trim());
  // The hook must run every render; a literal color simply ignores the result.
  const resolved = useCSSVariable(
    match
      ? [`--color-${match[1].replace(/^--/, "").replace(/^color-/, "")}`, match[1]]
      : ["--color-brand"]
  );
  if (!match) return color;
  const values = Array.isArray(resolved) ? resolved : [resolved];
  for (const entry of values) {
    if (typeof entry === "string" && entry.length > 0) return entry;
  }
  return "#ffffff";
}

/**
 * The web chart is an inline SVG sized by CSS; react-native-svg needs explicit
 * dimensions, so `w-*`/`h-*` classes are read off `className` and fall back to
 * the `width`/`height` props (viewBox scaling with `preserveAspectRatio="none"`
 * behaves exactly like the web original).
 */
export function Sparkline({
  values,
  color = "var(--brand)",
  className,
  width = 120,
  height = 36,
}: SparklineProps) {
  const rawId = useId();
  // `url(#…)` references must stay alphanumeric — React's ids contain colons.
  const gradientId = `sparkline-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const strokeColor = useSeriesColor(color);
  const series = values.length ? values : [0, 0];
  const max = Math.max(...series, 1);
  const min = Math.min(...series, 0);
  const span = max - min || 1;
  const padding = 3;

  const size = classDim(className, "size");
  const renderedWidth = classDim(className, "w") ?? size ?? width;
  const renderedHeight = classDim(className, "h") ?? size ?? height;

  const points: Point[] = series.map((value, index) => [
    (index / Math.max(1, series.length - 1)) * renderedWidth,
    padding + (1 - (value - min) / span) * (renderedHeight - padding * 2),
  ]);

  const style: StyleProp<ViewStyle> = {
    opacity: classOpacity(className) ?? 1,
    flexShrink: 0,
  };

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{ width: renderedWidth, height: renderedHeight }}
    >
      <Svg
        width={renderedWidth}
        height={renderedHeight}
        viewBox={`0 0 ${renderedWidth} ${renderedHeight}`}
        preserveAspectRatio="none"
        style={style}
      >
      <Defs>
        {/* Same vertical fade as the web SVG (objectBoundingBox units). */}
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={strokeColor} stopOpacity="0.35" />
          <Stop offset="1" stopColor={strokeColor} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Path d={areaPath(points, renderedHeight)} fill={`url(#${gradientId})`} />
      <Path
        d={smoothPath(points)}
        fill="none"
        stroke={strokeColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      </Svg>
    </View>
  );
}
