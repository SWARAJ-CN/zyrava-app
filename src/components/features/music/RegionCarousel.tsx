import { useCallback, useEffect, useState, type JSX } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { Icon } from "@/components/ui/icons";
import { REGIONS } from "./regions";
import { cn } from "@/lib/cn";
import { Scrim, SCRIM_STOPS } from "@/components/ui/Scrim";

/**
 * The featured strip at the top of the library: one wide panel per region
 * that rotates on its own, pauses while the reader is interacting, and
 * answers arrows / dots. (Arrow keys are a mouse-and-keyboard affordance —
 * dropped natively.) Selecting a region opens its catalogue below.
 *
 * Artwork sits in a square card on the right instead of stretching across
 * the whole panel — artwork on this CDN tops out at 500×500, so a full-bleed
 * cover would pixel-stretch. A dark gradient wash keeps the panel readable.
 */
interface RegionCarouselProps {
  /** Cover artwork per region label, fetched once by the page. */
  covers: Record<string, string>;
  /** Label of the region currently open in the library. */
  active: string;
  /** Queue label while that region's songs are playing, if any. */
  nowPlaying?: string;
  /** Cue the region up immediately — queues the first page and plays. */
  onPlay?: (label: string) => Promise<void> | void;
  /** Selects a region in the library below. */
  onSelect: (label: string) => void;
}

const ROTATE_MS = 6000;

export function RegionCarousel({
  covers,
  active,
  nowPlaying,
  onPlay,
  onSelect,
}: RegionCarouselProps): JSX.Element {
  const [index, setIndex] = useState(0);
  const [restRevision, setRestRevision] = useState(0);
  const reducedMotion = useReduceMotion();
  const [width, setWidth] = useState(0);
  /** Region whose play button is mid-fetch. */
  const [busy, setBusy] = useState("");
  const count = REGIONS.length;

  const go = useCallback((next: number) => setIndex(((next % count) + count) % count), [count]);

  /* Keep the shared value in lockstep with state; the panel slides with the
     web's 700 ms cubic-bezier(0.23,1,0.32,1) feel. */
  const offset = useSharedValue(0);
  useEffect(() => {
    offset.value = withTiming(-(index * (width || 1)), { duration: reducedMotion ? 0 : 300 });
    return () => cancelAnimation(offset);
  }, [index, width, offset, reducedMotion]);
  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  /** Play straight from the carousel — loading state until the queue lands. */
  const cue = (label: string) => {
    if (!onPlay || busy) return;
    setBusy(label);
    void Promise.resolve(onPlay(label)).finally(() => setBusy(""));
  };

  // Hiding the tab clears both timers; revealing it resumes from the same slide.
  useEffect(() => {
    if (reducedMotion) return;
    if (restRevision > 0) {
      const timer = setTimeout(() => setRestRevision(0), 12_000);
      return () => clearTimeout(timer);
    }
    const timer = setInterval(() => setIndex((value) => (value + 1) % count), ROTATE_MS);
    return () => clearInterval(timer);
  }, [restRevision, reducedMotion, count]);

  const rest = () => setRestRevision((value) => value + 1);

  return (
    <View
      accessibilityRole="summary"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      className="relative overflow-hidden"
      style={{ height: 190 }}
    >
      <Animated.View className="absolute inset-y-0 flex-row" style={slideStyle}>
        {REGIONS.map((region, regionIndex) => (
          <View
            key={region.label}
            style={{ width: width || undefined }}
            className="relative h-full flex-none"
          >
            {/* Tone wash + readable shade — no full-bleed cover stretching */}
            <View className={cn("absolute inset-0", region.toneClassName)} />
            <Scrim className="absolute inset-0" direction="right" colors={SCRIM_STOPS.hero} />

            <View className="relative h-full flex-row items-center justify-between gap-4 p-5">
              <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-2">
                  <Icon name="music" className="size-3.5" color="rgba(255,255,255,0.7)" />
                  <Text className="text-[10px] font-semibold uppercase tracking-[2.5px] text-white/70">
                    Now in rotation{region.hint ? ` · ${region.hint}` : ""}
                  </Text>
                </View>
                <Text
                  numberOfLines={1}
                  className="mt-2 text-[34px] font-black tracking-tight text-white"
                >
                  {region.label}
                </Text>
                <View className="mt-5 flex-row flex-wrap items-center gap-3">
                  <Pressable
                    onPress={() => {
                      rest();
                      cue(region.label);
                    }}
                    disabled={Boolean(busy)}
                    className={cn(
                      "flex-row items-center gap-2 rounded-full bg-white px-5 py-2.5",
                      busy === region.label && "opacity-80"
                    )}
                  >
                    <Icon
                      name={busy === region.label ? "loader" : "play"}
                      size={15}
                      color="#000"
                      fill="#000"
                    />
                    <Text className="text-[13px] font-bold text-black">
                      {busy === region.label
                        ? "Loading…"
                        : nowPlaying === region.label
                          ? "Playing"
                          : `Play ${region.label}`}
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* Square art card — crisp at any size, never stretched */}
              <View className="aspect-square w-28 flex-none overflow-hidden bg-black/30">
                {covers[region.label] ? (
                  <Image
                    source={{ uri: covers[region.label] }}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                    contentFit="cover"
                    transition={200}
                  />
                ) : (
                  <View className="h-full items-center justify-center">
                    <Icon name="music" className="size-8" color="rgba(255,255,255,0.7)" />
                  </View>
                )}
              </View>
            </View>
          </View>
        ))}
      </Animated.View>

      {/* Arrows — glass circles on the midline, like standard hero rails */}
      <Pressable
        onPress={() => {
          rest();
          go(index - 1);
        }}
        accessibilityLabel="Previous region"
        className="absolute start-2.5 top-1/2 z-10 size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/35"
      >
        <Icon name="chevron-left" size={18} color="#fff" />
      </Pressable>
      <Pressable
        onPress={() => {
          rest();
          go(index + 1);
        }}
        accessibilityLabel="Next region"
        className="absolute end-2.5 top-1/2 z-10 size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/35"
      >
        <Icon name="chevron-right" size={18} color="#fff" />
      </Pressable>

      {/* Dots — pill shaped, the active one stretches */}
      <View className="absolute bottom-3 end-5 z-10 flex-row items-center gap-1.5">
        {REGIONS.map((region, dotIndex) => (
          <Pressable
            key={region.label}
            onPress={() => {
              rest();
              go(dotIndex);
            }}
            accessibilityLabel={`Show ${region.label}`}
            className={cn(
              "h-1.5 rounded-full",
              dotIndex === index ? "w-7 bg-white" : "w-1.5 bg-white/45"
            )}
          />
        ))}
      </View>
    </View>
  );
}
