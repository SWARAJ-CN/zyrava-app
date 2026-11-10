import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { AccessibilityInfo } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import type { AnalyserNode } from "react-native-audio-api";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ *
 * The web card painted this with `--beat` / `--hue` CSS variables read by
 * globals.css (.beat-glow blobs: 58px blur, radial hsl gradients, 17/21/26 s
 * alternate drift cycles). React Native nodes carry no CSS variables, so the
 * SAME numbers drive Reanimated shared values: one rAF loop on the JS thread
 * reads the analyser's low band, smooths it with the original attack/release
 * constants, and writes level/hue/orbit into shared values; every blob is an
 * animated style reacting to them. The blurred radial glow is approximated by
 * a soft circular view (bare Views have no blur filter) — same orbit, same
 * pulse, same palette rotation, same reduced-motion still frame.
 * ------------------------------------------------------------------ */

interface BeatGlowProps {
  /** The live analyser tap — the player hands it over; null before first play. */
  getAnalyser: () => AnalyserNode | null;
  /** Live status: a paused/empty stream glows down to its resting level. */
  playing: boolean;
  /** Starting point on the colour wheel, so a new track shifts the palette. */
  hueSeed?: number;
  className?: string;
}

/** Stable 0-359 colour-wheel offset for a track id. */
export function songHueSeed(id: string | null | undefined): number {
  if (!id) return 0;
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % 360;
}

/** Bass band the beat reading comes from: everything under ~250 Hz. */
const BASS_BINS = 24;
/** Reading smoothing: fast attack to the beat, slow release off it. */
const ATTACK = 0.55;
const RELEASE = 0.06;

/** One full colour wheel every 23 seconds, started at the track's seed. */
const HUE_MS = 23_000;

/** The three blobs: start (CSS top/left), hue offset, alpha, and the
 *  beat-drift keyframe's end translate (as blob percentages) and rotation. */
const BLOBS = [
  { top: "4%", left: "6%", dx: 26, dy: 34, rotate: 140, offset: 0, alpha: 0.6, period: 17_000 },
  { top: "52%", left: "52%", dx: -30, dy: -24, rotate: -180, offset: 120, alpha: 0.6, period: 21_000 },
  { top: "78%", left: "12%", dx: 38, dy: -30, rotate: 220, offset: 240, alpha: 0.55, period: 26_000 },
];

type Drift = { x: number; y: number; r: number };

/** hsl → rgb for a Reanimated backgroundColor (0-360, %, %). */
function hsl(h: number, s: number, l: number): string {
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

function useReduceMotion(): boolean {
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

function Blob({
  spec,
  beat,
  hue,
  drift,
}: {
  spec: (typeof BLOBS)[number];
  beat: SharedValue<number>;
  hue: SharedValue<number>;
  drift: SharedValue<Drift>;
}) {
  /* .beat-glow i — opacity 0.2 + beat*0.55, scale 0.85 + beat*0.55, tinted
     hsl(hue + offset) 92% 58%; the orbit is the drift shared value. */
  const style = useAnimatedStyle(() => ({
    opacity: (0.2 + beat.value * 0.55) * spec.alpha,
    transform: [
      { translateX: drift.value.x },
      { translateY: drift.value.y },
      { rotate: `${drift.value.r}deg` },
      { scale: 0.85 + beat.value * 0.55 },
    ],
    backgroundColor: hsl(hue.value + spec.offset, 92, 58),
  }));

  return (
    <Animated.View
      // The web's 65%-wide round blob; aspect-square keeps it circular.
      className="absolute aspect-square rounded-full"
      style={[{ width: "65%", top: spec.top as `${number}%`, left: spec.left as `${number}%` }, style]}
    />
  );
}

/**
 * The Now-playing card's rotating RGB lights. Three colour blobs orbit behind
 * the artwork; a requestAnimationFrame loop reads the analyser's low band,
 * computes a smoothed bass level and feeds it to the blobs' opacity/scale
 * along with a slowly sweeping hue, so the card's lights pulse with the track
 * and never sit the same colour two beats in a row.
 *
 * Purely decorative — hidden from a11y, untouchable, and disabled for reduced
 * motion, where the blobs keep a gentle static hue.
 */
export function BeatGlow({ getAnalyser, playing, hueSeed = 0, className }: BeatGlowProps) {
  const reduced = useReduceMotion();
  const sizeRef = useRef({ width: 0, height: 0 });

  const beat = useSharedValue(0);
  const hue = useSharedValue(160);
  const drift0 = useSharedValue<Drift>({ x: 0, y: 0, r: 0 });
  const drift1 = useSharedValue<Drift>({ x: 0, y: 0, r: 0 });
  const drift2 = useSharedValue<Drift>({ x: 0, y: 0, r: 0 });
  const drifts = useMemo(() => [drift0, drift1, drift2], [drift0, drift1, drift2]);

  useEffect(() => {
    // The loop never starts for reduced motion — the CSS did the same,
    // leaving the blobs at a gentle static hue.
    if (reduced) {
      beat.value = 0;
      hue.value = 160;
      return;
    }

    let frame = 0;
    let level = 0;
    const bins = new Uint8Array(BASS_BINS);

    const readBass = (analyser: AnalyserNode): number => {
      const full = new Uint8Array(Math.min(analyser.frequencyBinCount, BASS_BINS));
      analyser.getByteFrequencyData(full);
      // Cheap copy into our fixed-size window keeps the smoothing math simple.
      bins.set(full);
      let sum = 0;
      for (const value of bins) sum += value;
      return sum / (BASS_BINS * 255);
    };

    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      const analyser = getAnalyser();
      const target =
        analyser && playing
          ? Math.min(1, readBass(analyser) * 2.2) /* bass is usually well under full swing */
          : 0;
      level =
        target > level ? level + (target - level) * ATTACK : level + (target - level) * RELEASE;
      beat.value = level;
      hue.value = (((time / HUE_MS) % 1) * 360 + hueSeed) % 360;
      // Each blob breathes along its own cycle: the CSS alternate keyframe ran
      // 0→end in `period`, then back — a raised cosine over 2*period matches
      // it, easing out and in like `ease-in-out`.
      const box = sizeRef.current.width || 240;
      const blob = box * 0.65;
      for (let index = 0; index < BLOBS.length; index += 1) {
        const spec = BLOBS[index];
        const wave = 0.5 - 0.5 * Math.cos((2 * Math.PI * time) / (spec.period * 2));
        drifts[index].value = {
          x: (spec.dx / 100) * blob * wave,
          y: (spec.dy / 100) * blob * wave,
          r: spec.rotate * wave,
        };
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [getAnalyser, playing, hueSeed, reduced, beat, hue, drifts]);

  return (
    <View
      aria-hidden
      accessibilityElementsHidden
      pointerEvents="none"
      className={cn("absolute overflow-hidden", className)}
      // inset: -22%
      style={{ top: "-22%", left: "-22%", right: "-22%", bottom: "-22%" }}
      onLayout={(event) => {
        sizeRef.current = {
          width: event.nativeEvent.layout.width,
          height: event.nativeEvent.layout.height,
        };
      }}
    >
      {BLOBS.map((spec, index) => (
        <Blob key={spec.top} spec={spec} beat={beat} hue={hue} drift={drifts[index]} />
      ))}
    </View>
  );
}
