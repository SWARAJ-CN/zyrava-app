import { Animation } from "@/components/ui/Animation";
import type { CustomizationConfig } from "@/lib/customization";
import { useEffect, useState } from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColor } from "heroui-native";
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { WakeAnimation } from "@/components/auth/WakeAnimation";

/** The PWA switches to its server-wake animation after 2.2 seconds. */
const WAKE_AFTER = 2200;

/* The five splash glyphs, paths copied from the web AuthGate verbatim.
   On the web the SVG inherits `text-accent` through currentColor; React Native
   has no cascade, so `color` is set on the <Svg> and every shape still strokes
   "currentColor" exactly as the web markup does. */
type GlyphShape =
  | { el: "path"; d: string }
  | { el: "rect"; x: number; y: number; width: number; height: number; rx: number }
  | { el: "circle"; cx: number; cy: number; r: number };

const SPLASH_GLYPHS: GlyphShape[][] = [
  [
    { el: "path", d: "M4 13.5v-1a8 8 0 0 1 16 0v1" },
    { el: "rect", x: 2.5, y: 13.5, width: 4.5, height: 7, rx: 2.25 },
    { el: "rect", x: 17, y: 13.5, width: 4.5, height: 7, rx: 2.25 },
  ],
  [
    { el: "rect", x: 5, y: 2.5, width: 14, height: 19, rx: 3 },
    { el: "circle", cx: 12, cy: 15.5, r: 3.5 },
    { el: "circle", cx: 12, cy: 7.5, r: 1.25 },
  ],
  [
    { el: "circle", cx: 12, cy: 12, r: 9 },
    { el: "circle", cx: 12, cy: 12, r: 2.75 },
  ],
  [
    { el: "rect", x: 9, y: 2.5, width: 6, height: 11, rx: 3 },
    { el: "path", d: "M5.5 11.5a6.5 6.5 0 0 0 13 0" },
    { el: "path", d: "M12 18v3.5" },
  ],
  [
    { el: "path", d: "M9 17.5V6l10-2.2v11" },
    { el: "circle", cx: 6.75, cy: 17.5, r: 2.25 },
    { el: "circle", cx: 16.75, cy: 14.8, r: 2.25 },
  ],
];

function Glyph({ shapes, color }: { shapes: GlyphShape[]; color: string }) {
  return (
    <Svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      color={color}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shapes.map((shape, index) =>
        shape.el === "path" ? (
          <Path key={index} d={shape.d} />
        ) : shape.el === "rect" ? (
          <Rect
            key={index}
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
            rx={shape.rx}
          />
        ) : (
          <Circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} />
        )
      )}
    </Svg>
  );
}

/* zepto-jump — CSS keyframes become a Reanimated loop. The web animation
   mirrors the cubic-bezier across its midpoint (0→50% and 50%→100% share the
   curve), which is exactly a reversed-repeat ping-pong of one eased half:
   550 ms out, 550 ms back = the 1.1 s period, staggered i * 0.14 s.
   The web runs this glyph loop unconditionally (inline style, no motion-safe),
   so the native loop stays unconditional too. */
function JumpingGlyph({
  shapes,
  color,
  delay,
}: {
  shapes: GlyphShape[];
  color: string;
  delay: number;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 550, easing: Easing.bezier(0.4, 0, 0.2, 1) }), -1, true)
    );
    return () => cancelAnimation(progress);
  }, [delay, progress]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [5, -6]) },
      { scale: interpolate(progress.value, [0, 1], [0.8, 1.15]) },
    ],
    opacity: interpolate(progress.value, [0, 1], [0.35, 1]),
  }));

  return (
    <Animated.View style={[styles.glyphCell, style]}>
      <Glyph shapes={shapes} color={color} />
    </Animated.View>
  );
}

/** Soft green aura matching the PWA; radial fades replace browser blur. */
function RotatingAura() {
  const window = Dimensions.get("window");
  const side = Math.round(Math.min(window.width, window.height) * 1.5);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 10000, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(progress);
  }, [progress]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${progress.value * 360}deg` },
      { scale: interpolate(progress.value, [0, 0.5, 1], [1, 1.15, 1]) },
    ],
  }));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.auraHost}>
        <Animated.View
          style={[style, { width: side, height: side, borderRadius: side / 2, opacity: 0.18 }]}
        >
          <Svg width={side} height={side} viewBox="0 0 600 600">
            <Defs>
              <RadialGradient id="aura" cx="45%" cy="40%" r="60%">
                <Stop offset="0" stopColor="#10b981" stopOpacity={0.9} />
                <Stop offset="0.45" stopColor="#022c22" stopOpacity={0.5} />
                <Stop offset="1" stopColor="#022c22" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={300} cy={300} r={300} fill="url(#aura)" />
          </Svg>
        </Animated.View>
      </View>
    </View>
  );
}

/* The brand mark's orbiting progress arc: border-2 + border-t-accent +
   animate-spin 1.6s becomes an SVG ring whose top quarter strokes the accent —
   exactly where `border-t` paints it — and rotates on the same clock.
   `motion-safe:` → under a reduced-motion flag the ring simply stops
   spinning, as on the web. */
function OrbitingMark() {
  const separator = useThemeColor("separator");
  const accent = useThemeColor("accent");
  const reduced = useReducedMotion();
  const spin = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    spin.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(spin);
  }, [reduced, spin]);

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  return (
    <View style={styles.mark}>
      <Animated.View style={[StyleSheet.absoluteFill, style]}>
        <Svg width={80} height={80} viewBox="0 0 80 80" fill="none">
          <Circle cx={40} cy={40} r={39} stroke={separator} strokeWidth={2} />
          <Path d="M12.42 12.42 A39 39 0 0 1 67.58 12.42" stroke={accent} strokeWidth={2} />
        </Svg>
      </Animated.View>

      {/* Tinted disc so the glyphs have something to sit on — bg-accent/[0.06] */}
      <View style={[styles.disc, { backgroundColor: accent }]} />

      {/* Center items aligned in a row, jumping sequentially */}
      <View pointerEvents="none" style={styles.glyphRow}>
        {SPLASH_GLYPHS.map((shapes, index) => (
          <JumpingGlyph key={index} shapes={shapes} color={accent} delay={index * 140} />
        ))}
      </View>
    </View>
  );
}

/* The progress line: a hair of `surface` with an accent third sweeping
   -100% → 300% on `splash-sweep` (1.4 s ease-in-out, infinite, motion-safe).
   Under reduced motion the CSS animation is absent and the bar rests at the
   track's left edge — mirrored here with a static placement. */
function SweepLine({ width }: { width: number }) {
  const surface = useThemeColor("surface");
  const accent = useThemeColor("accent");
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    progress.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      -1,
      false
    );
    return () => cancelAnimation(progress);
  }, [reduced, progress]);

  const bar = width / 3;
  const style = useAnimatedStyle(() =>
    reduced
      ? { transform: [{ translateX: 0 }] }
      : { transform: [{ translateX: interpolate(progress.value, [0, 1], [-bar, width]) }] }
  );

  if (!width) return <View style={[styles.sweepTrack, { backgroundColor: surface }]} />;

  return (
    <View pointerEvents="none" style={[styles.sweepTrack, { backgroundColor: surface }]}>
      <Animated.View style={[styles.sweepBar, { width: bar, backgroundColor: accent }, style]} />
    </View>
  );
}

/** Shared by startup, session recovery, and a pending sign-in/register request. */
export function AuthLoadingScreen({
  allowWake = true,
  welcome,
}: {
  allowWake?: boolean;
  welcome?: { config: CustomizationConfig; personal: boolean } | null;
}) {
  const background = useThemeColor("background");
  const [waking, setWaking] = useState(false);
  const [splashWidth, setSplashWidth] = useState(0);

  useEffect(() => {
    if (!allowWake) return;
    const timer = setTimeout(() => setWaking(true), WAKE_AFTER);
    return () => clearTimeout(timer);
  }, [allowWake]);

  if (welcome)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: welcome.config.background,
          alignItems: "center",
          justifyContent: "center",
          padding: 28,
        }}
      >
        <Animation
          id={welcome.personal ? "personal-welcome" : welcome.config.loadingAnimation}
          style={{ width: "100%", height: 270 }}
        />
        <Text
          style={{
            color: welcome.config.text,
            fontSize: 24,
            fontWeight: "700",
            textAlign: "center",
          }}
        >
          {welcome.personal ? "Welcome back, Baava" : welcome.config.title}
        </Text>
        <Text
          accessibilityLiveRegion="polite"
          style={{
            color: welcome.config.text,
            opacity: 0.7,
            fontSize: 14,
            textAlign: "center",
            marginTop: 16,
          }}
        >
          {welcome.config.loadingMessage}
        </Text>
      </SafeAreaView>
    );
  return (
    <SafeAreaView
      edges={["top", "bottom", "left", "right"]}
      style={{ flex: 1, backgroundColor: background }}
    >
      <View
        style={{ flex: 1, overflow: "hidden", paddingHorizontal: 24, alignItems: "center" }}
        onLayout={(event) =>
          setSplashWidth(Math.max(0, Math.min(event.nativeEvent.layout.width - 48, 272)))
        }
      >
        <RotatingAura />

        {waking && allowWake ? (
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLiveRegion="polite"
            accessibilityState={{ busy: true }}
            style={[styles.column, { maxWidth: 304 }]}
          >
            <WakeAnimation />

            <View style={styles.stack}>
              <Text className="text-center text-sm font-semibold uppercase tracking-[4.48px] text-foreground">
                ZYRAVA
              </Text>
              <Text className="text-center text-[11px] font-semibold uppercase tracking-[2.64px] text-brand">
                Waking up the server
              </Text>
            </View>

            <Text className="text-center text-[11px] leading-[18px] tracking-[0.4px] text-faint-foreground">
              This instance had gone quiet. The first answer takes a few seconds — the app itself is
              already on your screen.
            </Text>
          </View>
        ) : (
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLiveRegion="polite"
            accessibilityState={{ busy: true }}
            style={[styles.column, { maxWidth: 272, gap: 32 }]}
          >
            <OrbitingMark />

            {/* Wordmark */}
            <View style={styles.stack}>
              <Text className="text-center text-sm font-semibold uppercase tracking-[4.48px] text-foreground">
                ZYRAVA
              </Text>
              <Text className="text-center text-[10px] uppercase tracking-[2.4px] text-muted">
                Listening studio
              </Text>
            </View>

            {/* Progress line + status */}
            <View style={{ width: "100%", gap: 10 }}>
              <SweepLine width={splashWidth} />
              <Text className="text-center text-[11px] tracking-[0.4px] text-faint-foreground">
                Hey it&apos;s you Hmmm....?
              </Text>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

/* The stylesheet carries only geometry (aura disc, mark sizing, sweep rail);
   every colour and typographic metric lives in `className` — em tracking was
   resolved to the px value the browser computes, matching the `tracking-[…]`
   idiom of the sibling ports. aria-live/aria-busy have no native twin;
   accessibilityRole="progressbar" accessibilityLiveRegion="polite" accessibilityState={{ busy: true }} is the closest announcement surface. */
const styles = StyleSheet.create({
  auraHost: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  column: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 28,
  },
  mark: { width: 80, height: 80, alignItems: "center", justifyContent: "center" },
  disc: {
    position: "absolute",
    top: 3,
    right: 3,
    bottom: 3,
    left: 3,
    borderRadius: 37,
    opacity: 0.06,
  },
  glyphRow: { position: "absolute", flexDirection: "row", alignItems: "center", gap: 4 },
  glyphCell: { alignItems: "center", justifyContent: "center" },
  stack: { gap: 6, alignItems: "center" },
  sweepTrack: { height: 1, width: "100%", overflow: "hidden", borderRadius: 1 },
  sweepBar: { position: "absolute", top: 0, bottom: 0, left: 0, borderRadius: 999 },
});
