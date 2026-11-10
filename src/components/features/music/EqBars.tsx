import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { useCSSVariable } from "uniwind";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { cn } from "@/lib/cn";

/**
 * The CSS `.eq` three-bar mimic, ported to Reanimated.
 *
 * On the web the bars are `<span>`s that inherit `currentColor` and run the
 * `music-eq` keyframes (30% → 100% of a 12px box, 0.9 s ease-in-out infinite,
 * 0.18 s and 0.36 s delays on bars two and three). React Native has no CSS
 * keyframes for arbitrary nodes and a View cannot inherit a text colour, so
 * the same rhythm is driven by shared values and the colour arrives through
 * the `color` prop — resolved from `var(--accent)` when omitted (rows and
 * panels sit in the brand tone on the web; artwork overlays pass "#ffffff").
 * Reduced motion keeps the bars at the static 30% resting height, exactly as
 * the `prefers-reduced-motion` CSS branch does.
 */

const MAX_HEIGHT = 12; // .eq { height: 12px }
const ANIMATION_MS = 900; // music-eq 0.9s
const DELAYS = [0, 180, 360]; // nth-child(2): .18s · nth-child(3): .36s

export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

function Bar({ delay, color, reduced }: { delay: number; color: string; reduced: boolean }) {
  const shared = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      shared.value = 0;
      return;
    }
    // One cycle = 450 ms up + 450 ms down (alternate repeat, as in CSS).
    shared.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: ANIMATION_MS / 2, easing: Easing.inOut(Easing.quad) }),
        -1,
        true
      )
    );
  }, [shared, delay, reduced]);

  const style = useAnimatedStyle(() => ({
    // .eq > span — 3px wide, 2px radius, 30% at rest, 100% at the peak.
    width: 3,
    borderRadius: 2,
    backgroundColor: color,
    height: reduced ? MAX_HEIGHT * 0.3 : MAX_HEIGHT * (0.3 + shared.value * 0.7),
  }));

  return <Animated.View style={style} />;
}

export function EqBars({ color, className }: { color?: string; className?: string }) {
  const accent = useCSSVariable("var(--accent)");
  const reduced = useReduceMotion();
  const resolved = color ?? (typeof accent === "string" && accent ? accent : "#10b981");

  return (
    <View
      aria-hidden
      accessibilityElementsHidden
      className={cn("flex-row items-end gap-0.5", className)}
      style={{ height: MAX_HEIGHT }}
    >
      {DELAYS.map((delay) => (
        <Bar key={delay} delay={delay} color={resolved} reduced={reduced} />
      ))}
    </View>
  );
}
