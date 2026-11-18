import { memo, useEffect, type ReactNode } from "react";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

/** A damped spring gives the active line a small elastic lift on the UI thread. */
export const LyricLineMotion = memo(function LyricLineMotion({
  opacity,
  active,
  children,
}: {
  opacity: number;
  active: boolean;
  children: ReactNode;
}) {
  const fade = useSharedValue(opacity);
  const offset = useSharedValue(0);
  const lift = useSharedValue(0);
  useEffect(() => {
    const config = {
      duration: 260,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    };
    fade.value = withTiming(opacity, config);
  }, [opacity, fade]);
  useEffect(() => {
    const spring = {
      damping: 12,
      stiffness: 180,
      mass: 0.7,
      overshootClamping: false,
      reduceMotion: ReduceMotion.System,
    };
    offset.value = withSpring(active ? 6 : 0, spring);
    lift.value = withSpring(active ? -1.5 : 0, spring);
  }, [active, offset, lift]);
  const style = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateX: offset.value }, { translateY: lift.value }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
});
