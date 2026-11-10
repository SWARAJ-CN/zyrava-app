import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { useThemeColor } from "heroui-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

/* ------------------------------------------------------------------ *
 * The web screen swaps the ordinary splash for a dotlottie player:
 *
 *   DotLottie.setWasmUrl("/animations/dotlottie-player-0.82.1.wasm");
 *   <DotLottieReact src="/animations/server-wake.lottie" loop autoplay
 *     style={{ width: "8.5rem", height: "8.5rem" }} />
 *
 * The WASM runtime and the fetched animation file are exactly what a cold
 * origin cannot deliver here, so the native build renders an equivalent
 * pulse in Reanimated instead. Swap path: `@lottiefiles/dotlottie-react-native`
 * (Skia-based, no network) loading the same server-wake.lottie bundled as an
 * asset — one component body, every caller unchanged.
 * ------------------------------------------------------------------ */

/** 8.5rem — the size the web gave the animation. */
const SIZE = 136;

/** One radar pulse: a ring breathing outward and fading, staggered per echo. */
function PulseRing({ delay }: { delay: number }) {
  const accent = useThemeColor("accent");
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: 1900, easing: Easing.out(Easing.quad) }),
        -1,
        false,
      ),
    );
  }, [delay, progress]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.35, 1.25]) }],
    opacity: interpolate(progress.value, [0, 1], [0.6, 0]),
    borderColor: accent,
  }));

  return <Animated.View style={[styles.ring, style]} />;
}

export function WakeAnimation() {
  const accent = useThemeColor("accent");
  const beat = useSharedValue(0);

  useEffect(() => {
    beat.value = withRepeat(
      withTiming(1, { duration: 950, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [beat]);

  const coreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(beat.value, [0, 1], [1, 1.18]) }],
    opacity: interpolate(beat.value, [0, 1], [0.75, 1]),
    backgroundColor: accent,
  }));

  return (
    <View
      accessible
      accessibilityLabel="Waking up the server"
      style={styles.box}
    >
      <PulseRing delay={0} />
      <PulseRing delay={630} />
      <PulseRing delay={1260} />
      <Animated.View style={[styles.core, coreStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  ring: {
    position: "absolute",
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 2,
    borderStyle: "solid",
  },
  core: { width: 34, height: 34, borderRadius: 17 },
});
