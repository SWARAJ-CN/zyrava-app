import { memo, useEffect, useMemo, useState } from "react";
import { AppState, Text, View, type StyleProp, type ViewStyle } from "react-native";
import LottieView from "lottie-react-native";
import { ANIMATION_ASSETS, type BundledAnimation } from "@/lib/animation-assets";
import { isSelfContainedAnimation } from "@/lib/animation-source";
import { useReduceMotion } from "@/hooks/useReduceMotion";

const DEFAULT_STYLE = { width: "100%", height: 180 } as const;

export const Animation = memo(function Animation({
  id,
  playing = true,
  style = DEFAULT_STYLE,
}: {
  id: BundledAnimation | "none";
  playing?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const reduced = useReduceMotion();
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) =>
      setForeground(state === "active")
    );
    return () => listener.remove();
  }, []);
  const source = useMemo(() => {
    if (id === "none") return null;
    const candidate = ANIMATION_ASSETS[id]?.();
    return isSelfContainedAnimation(candidate) ? candidate : null;
  }, [id]);
  if (id === "none") return null;
  if (failed === id || !source)
    return (
      <View style={style} className="items-center justify-center">
        <Text accessibilityLiveRegion="polite" className="text-sm text-muted">
          Animation preview unavailable
        </Text>
      </View>
    );
  return (
    <LottieView
      key={`${id}:${reduced ? "still" : "motion"}`}
      source={source}
      onAnimationFailure={() => setFailed(id)}
      enableMergePathsAndroidForKitKatAndAbove
      enableSafeModeAndroid
      // React Activity can detach a native view before effect cleanup runs.
      // Use native props for playback; never dispatch pause/resume in cleanup.
      autoPlay={!reduced}
      speed={playing && foreground && !reduced ? 1 : 0}
      loop
      useNativeLooping
      resizeMode="contain"
      progress={reduced ? 0.33 : undefined}
      style={style}
    />
  );
});
