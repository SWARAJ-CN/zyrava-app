import { useEffect, useState, type ReactNode } from "react";
import { Text, View, AccessibilityInfo } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import type { AnalyserNode } from "react-native-audio-api";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ *
 * The web version clipped a rainbow to the glyphs and uncovered it from the
 * floor of the text with a CSS mask driven by `--fill`. RN has no text mask,
 * so the second layer is the same text painted in the sweeping hue, with its
 * opacity following the smoothed beat level (0.08 + fill * 0.24 — the web's
 * own opacity formula) instead of the gradient mask. Same API, same bass
 * maths, same FOLLOW normalisation; only the mask simplifies away.
 * ------------------------------------------------------------------ */

interface BeatWordmarkProps {
  /** The live analyser tap — the player hands it over; null before first play. */
  getAnalyser: () => AnalyserNode | null;
  playing: boolean;
  /** Starting point on the colour wheel, so a new track shifts the palette. */
  hueSeed?: number;
  className?: string;
  children: ReactNode;
}

/* Bass band the beat is read from: everything under ~250 Hz. */
const BASS_BINS = 24;
/* The fill climbs onto a hit and drains slowly off it, so the colour rises
   with the beat instead of flickering with it. */
const ATTACK = 0.5;
const RELEASE = 0.07;
/* How fast the reference level follows the track's own loudness. Slow, so a
   quiet passage still shows its beats and a loud one does not pin the meter. */
const FOLLOW = 0.012;
/** One full colour wheel every 40 seconds. */
const DRIFT = 360 / 40_000;

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

/**
 * The oversized wordmark with the RGB *inside* the letterforms, rising from
 * the floor of the text toward its ceiling on every beat. Two layers share
 * one box: the faint watermark as it always looked, and the same text in the
 * drifting hue whose opacity is the smoothed beat level. The level is
 * measured against the track's own running average, so a loud mix does not
 * pin the colour at the top of the letters.
 *
 * Purely decorative — hidden from a11y, and the loop never starts for reduced
 * motion, where a still, faint wash stays at the foot of the wordmark.
 */
export function BeatWordmark({
  getAnalyser,
  playing,
  hueSeed = 0,
  className,
  children,
}: BeatWordmarkProps) {
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

  const fill = useSharedValue(0);
  const hue = useSharedValue(hueSeed);

  useEffect(() => {
    if (reduced || !playing) {
      fill.value = 0;
      return;
    }

    let frame = 0;
    let lastFrame = 0;
    let level = 0;
    let reference = -1;
    let bins = new Uint8Array(0);

    const readBass = (analyser: AnalyserNode): number => {
      const size = Math.min(analyser.frequencyBinCount, BASS_BINS);
      if (bins.length !== size) bins = new Uint8Array(size);
      analyser.getByteFrequencyData(bins);
      let sum = 0;
      for (const value of bins) sum += value;
      return sum / (size * 255);
    };

    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      if (time - lastFrame < 1000 / 24) return;
      lastFrame = time;
      const analyser = getAnalyser();
      const bass = analyser && playing ? readBass(analyser) : 0;
      if (reference < 0) reference = bass;
      reference += (bass - reference) * FOLLOW;
      const pulse = Math.min(1, Math.max(0, (bass - reference * 1.1) / (reference * 0.9 + 0.06)));
      level = pulse > level ? level + (pulse - level) * ATTACK : level + (pulse - level) * RELEASE;
      fill.value = level;
      hue.value = (hueSeed + time * DRIFT) % 360;
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [getAnalyser, playing, hueSeed, reduced, fill, hue]);

  /* The watermark layer stays exactly as faint as the web's [0.045] wash;
     the rgb layer's opacity mirrors `calc(0.08 + var(--fill) * 0.24)`, and
     reduced motion pins it at the web's 0.12 still wash. Both layers are
     <Text> — a raw string cannot live inside a <View> on native, and the
     sweeping hue must ride on the text itself (View colors don't cascade). */
  const glowStyle = useAnimatedStyle(() => ({
    opacity: reduced ? 0.12 : 0.08 + fill.value * 0.24,
    color: hsl(hue.value, 92, 60),
  }));

  return (
    <View aria-hidden accessibilityElementsHidden className="relative">
      {/* stacked layers: both share the box; the base one sizes it. */}
      <Text className={cn("opacity-[0.045]", className)}>{children}</Text>
      <Animated.Text className={cn("absolute inset-0", className)} style={glowStyle}>
        {children}
      </Animated.Text>
    </View>
  );
}
