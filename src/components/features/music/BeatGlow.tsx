import { useEffect, useId, useState } from "react";
import { AppState, StyleSheet } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import type { AnalyserNode } from "react-native-audio-api";
import { useReduceMotion } from "@/hooks/useReduceMotion";

interface BeatGlowProps {
  getAnalyser: () => AnalyserNode | null;
  playing: boolean;
  hueSeed?: number;
  className?: string;
}

export function songHueSeed(id: string | null | undefined): number {
  if (!id) return 0;
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function hsl(h: number, s: number, l: number): string {
  "worklet";
  const c = (1 - Math.abs((2 * l) / 100 - 1)) * (s / 100);
  const x = c * (1 - Math.abs((((((h % 360) + 360) % 360) / 60) % 2) - 1));
  const m = l / 100 - c / 2;
  const seg = (((h % 360) + 360) % 360) / 60;
  const [r, g, b] =
    seg < 1
      ? [c, x, 0]
      : seg < 2
        ? [x, c, 0]
        : seg < 3
          ? [0, c, x]
          : seg < 4
            ? [0, x, c]
            : seg < 5
              ? [x, 0, c]
              : [c, 0, x];
  const to255 = (v: number) => Math.round((v + m) * 255);
  return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}

/** A quiet, edge-to-edge colour wash. No circles, rotation or blur dependency. */
export function BeatGlow({ getAnalyser, playing, hueSeed = 160, className }: BeatGlowProps) {
  const reduced = useReduceMotion();
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const beat = useSharedValue(0);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active")
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (reduced || !playing || !foreground) {
      beat.value = 0;
      return;
    }
    let frame = 0;
    let last = 0;
    let level = 0;
    const bins = new Uint8Array(24);
    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      if (time - last < 50) return;
      last = time;
      let target = 0;
      try {
        const analyser = getAnalyser();
        if (analyser) {
          analyser.getByteFrequencyData(bins);
          target = Math.min(
            1,
            (bins.reduce((sum, value) => sum + value, 0) / (bins.length * 255)) * 1.8
          );
        }
      } catch {
        /* An audio graph swap can briefly detach the analyser. */
      }
      level += (target - level) * (target > level ? 0.25 : 0.08);
      beat.value = level;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [getAnalyser, playing, foreground, reduced, beat]);
  const style = useAnimatedStyle(() => ({ opacity: 0.22 + beat.value * 0.12 }));
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      className={className}
      style={[StyleSheet.absoluteFill, style]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={`${id}wash`} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0" stopColor={hsl(hueSeed, 65, 55)} stopOpacity="0.9" />
            <Stop offset="0.45" stopColor={hsl(hueSeed + 35, 50, 45)} stopOpacity="0.12" />
            <Stop offset="1" stopColor={hsl(hueSeed + 80, 60, 55)} stopOpacity="0.6" />
          </LinearGradient>
        </Defs>
        <Rect width="100" height="100" fill={`url(#${id}wash)`} />
      </Svg>
    </Animated.View>
  );
}
