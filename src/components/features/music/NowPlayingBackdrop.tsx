import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { useThemeColor } from "heroui-native";
import type { AnalyserNode } from "react-native-audio-api";
import { BeatGlow } from "./BeatGlow";

/** Full-surface gradients need no optional native blur module to look soft. */
export const NowPlayingBackdrop = memo(function NowPlayingBackdrop({
  getAnalyser,
  playing,
  hueSeed,
}: {
  getAnalyser: () => AnalyserNode | null;
  playing: boolean;
  hueSeed: number;
}) {
  const backgroundColor = useThemeColor("background");
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { backgroundColor, overflow: "hidden" }]}
    >
      <BeatGlow getAnalyser={getAnalyser} playing={playing} hueSeed={hueSeed} />
    </View>
  );
});
