import { useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { useCSSVariable } from "uniwind";
import Svg, { Rect } from "react-native-svg";
import Animated, {
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import type { AnalyserNode } from "react-native-audio-api";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ *
 * The web canvas became one <Svg> of <Rect> bars.
 *
 * Same maths: log-spaced FFT bin bands, pow(x, 0.8) spike taming, 0.55 rise /
 * 0.16 fall smoothing, calm sine idle drift when there is nothing to sample,
 * and the rAF loop still reads getByteFrequencyData without React state —
 * heights ride a SharedValue and each bar's geometry is applied by a
 * UI-thread animatedProps, with sampling capped at 24 Hz and 40 bars per visible visualizer.
 *
 * The canvas DPR scaling and ResizeObserver are gone: SVG is vector (no pixel
 * ratio to multiply) and the parent's onLayout reports the same size changes.
 * `currentColor` does not exist in react-native-svg, so the bar colour comes
 * from the `color` prop — callers resolve their CSS var through
 * useCSSVariable("var(--accent)") (or pass a literal like "#ffffff"), and the
 * internal default mirrors the brand emerald.
 * ------------------------------------------------------------------ */

const AnimatedRect = Animated.createAnimatedComponent(Rect);

export interface WaveformProps {
  /** Accessor for the analyser; may return null while audio is unavailable. */
  getAnalyser: () => AnalyserNode | null;
  /** Whether the user considers this track "playing" — controls the idle drift. */
  active: boolean;
  className?: string;
  /** Rough gap ratio between bars; small visualisers get denser bars. */
  density?: number;
  /** Bar fill — replaces the web's `currentColor` inheritance. */
  color?: string;
}

interface Layout {
  width: number;
  height: number;
  bars: number;
}

function Bar({
  index,
  heights,
  layout,
  color,
}: {
  index: number;
  heights: SharedValue<number[]>;
  layout: SharedValue<Layout>;
  color: string;
}) {
  const animatedProps = useAnimatedProps(() => {
    const { width, height, bars } = layout.value;
    const barWidth = width / bars;
    const gap = Math.min(2, barWidth * 0.25);
    const inner = Math.max(0.5, barWidth - gap);
    const level = heights.value[index] ?? 0.1;
    const barHeight = Math.max(2, level * height);
    return {
      x: index * barWidth + gap / 2,
      y: height - barHeight,
      width: inner,
      height: barHeight,
      rx: inner / 2,
    };
  });

  return <AnimatedRect animatedProps={animatedProps} fill={color} />;
}

export function Waveform({ getAnalyser, active, className, density = 7, color }: WaveformProps) {
  const accent = useCSSVariable("var(--accent)");
  const fill = color ?? (typeof accent === "string" && accent ? accent : "#10b981");

  const reducedMotion = useReducedMotion();
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active")
    );
    return () => subscription.remove();
  }, []);
  const activeRef = useRef(active);
  const getAnalyserRef = useRef(getAnalyser);
  /** Same numbers in two seats: a ref for this thread's loop, a shared value
   *  for the UI-thread bar maths (Reanimated forbids cross-thread mutation
   *  of values that live in effect closures). */
  const sizeRef = useRef<Layout>({ width: 0, height: 0, bars: 3 });
  const layout = useSharedValue<Layout>({ width: 0, height: 0, bars: 3 });
  const heights = useSharedValue<number[]>([]);
  const [bars, setBars] = useState(3);

  useEffect(() => {
    activeRef.current = active;
    getAnalyserRef.current = getAnalyser;
  }, [active, getAnalyser]);

  useEffect(() => {
    if (!active || !foreground || reducedMotion) {
      heights.value = Array(sizeRef.current.bars).fill(0.08);
      return;
    }
    let running = true;
    let frame = 0;
    let lastFrame = 0;
    /** Kept on this thread so the smoothing keeps its history between frames. */
    let smoothed: number[] = [];
    // One reusable spectrum buffer; resized only when it doesn't match.
    const bufferRef = { data: new Uint8Array(0) };

    const draw = (timestamp: number) => {
      if (!running) return;
      frame = requestAnimationFrame(draw);
      if (timestamp - lastFrame < 1000 / 24) return;
      lastFrame = timestamp;
      const analyser = getAnalyserRef.current();
      let data: Uint8Array | null = null;
      if (analyser) {
        if (bufferRef.data.length !== analyser.frequencyBinCount) {
          bufferRef.data = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(bufferRef.data);
        data = bufferRef.data;
      }

      const count = sizeRef.current.bars;
      const next = smoothed.slice(0, count);
      while (next.length < count) next.push(0.1);

      for (let index = 0; index < count; index += 1) {
        let target: number;
        if (data && analyser) {
          // Log-ish mapping: treat bins as power-of-two bands so each bar gets
          // its share of the spectrum instead of thin slices of silence.
          const from = Math.floor(Math.pow(data.length, index / count));
          const to = Math.max(from + 1, Math.floor(Math.pow(data.length, (index + 1) / count)));
          let sum = 0;
          for (let bin = from; bin < to && bin < data.length; bin += 1) sum += data[bin];
          const average = sum / (to - from);
          target = Math.max(average / 255, activeRef.current ? 0.03 : 0.06);
          target = Math.pow(target, 0.8); // tame the spikes
        } else {
          // Idle drift while there is nothing to sample.
          const time = performance.now() / 1000;
          target = 0.08 + 0.05 * Math.abs(Math.sin(time * 1.1 + index * 0.9));
        }

        // Smooth rise fast, fall slow — reads as "bouncy" not "flickery".
        next[index] += (target - next[index]) * (next[index] < target ? 0.55 : 0.16);
      }

      smoothed = next;
      heights.value = next;
    };

    frame = requestAnimationFrame(draw);
    return () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    // Size changes update refs without restarting the animation.
  }, [active, foreground, reducedMotion, density, heights]);

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      className={cn("h-full w-full", className)}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width === 0 || height === 0) return;
        // ResizeObserver → onLayout; DPR scaling skipped (vector output).
        const next = {
          width,
          height,
          bars: Math.min(40, Math.max(3, Math.floor(width / density))),
        };
        sizeRef.current = next;
        layout.value = next;
        setBars((previous) => (previous === next.bars ? previous : next.bars));
      }}
    >
      <Svg width="100%" height="100%">
        {Array.from({ length: bars }).map((_, index) => (
          <Bar key={index} index={index} heights={heights} layout={layout} color={fill} />
        ))}
      </Svg>
    </View>
  );
}
