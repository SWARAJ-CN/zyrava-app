import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useThemeColor } from "heroui-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  withTiming,
} from "react-native-reanimated";
import { ChevronLeft, ChevronRight, Pause } from "lucide-react-native";
import { Image } from "expo-image";

import { Icon } from "@/components/ui/icons";
import { getTrendingSlides, type TrendingSlide } from "@/lib/trending";

/* ------------------------------------------------------------------ *
 * The auth screen's trending gallery, ported from the web
 * components/auth/TrendingCarousel.tsx.
 *
 * • The web kept TWO variants (a wide aside panel behind the desktop form
 *   and a `compact` card above the mobile form). The phone build is the
 *   compact card, so it is the only variant here.
 * • The web carousel is not a paging scroller — every slide is mounted and
 *   the change is a stacked crossfade (900 ms / 1200 ms for the bleed).
 *   That structure is kept (no FlatList/ScrollView snapping was ever used
 *   on the web, so none is invented here).
 * • The client fallback fetched `/api/music/search?q=…` through the Next
 *   route handler, which proxied saavn's search. Natively that route IS
 *   `searchSongs`, so the fallback calls `getTrendingSlides` from
 *   `@/lib/trending` — same QUERIES, same slideKey dedupe, same
 *   MAX_SLIDES cap, same 5-minute cache, same "keep the empty state if the
 *   fetch fails" rule.
 * • `window.matchMedia("(prefers-reduced-motion: reduce)")` becomes
 *   Reanimated's useReducedMotion.
 * • next/image → expo-image (`fill` → absolute-fill + contentFit cover;
 *   `blur-2xl` → blurRadius, a close approximation of 40 px of CSS blur).
 * • Hover styles are mouse-only affordances and are dropped; the web's
 *   `shadow-pop` becomes the standard RN shadow recipe.
 * ------------------------------------------------------------------ */

const EASE_OUT = Easing.bezier(0, 0, 0.2, 1);

/** One mounted slide layer: opacity 0/1 with the web's duration curve. */
function Fade({
  active,
  duration,
  children,
}: {
  active: boolean;
  duration: number;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(active ? 1 : 0, { duration, easing: EASE_OUT }),
  }));
  return (
    <Animated.View pointerEvents={active ? undefined : "none"} style={[StyleSheet.absoluteFill, style]}>
      {children}
    </Animated.View>
  );
}

export function TrendingCarousel({ initialSlides = [] }: { initialSlides?: TrendingSlide[] }) {
  /* The web seeded `slides` from server-rendered `initialSlides` once; the
     route's mount effect plays that part natively, and the chart can land
     after first paint. Deriving keeps the same precedence (route-provided
     slides win when they fill the chart; otherwise the fallback result)
     without a state-syncing effect. */
  const [fetched, setFetched] = useState<TrendingSlide[] | null>(null);
  const slides = initialSlides.length >= 2 ? initialSlides : (fetched ?? initialSlides);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion();

  const accent = useThemeColor("accent");
  const muted = useThemeColor("muted");
  const surfaceSecondary = useThemeColor("surface-secondary");
  const background = useThemeColor("background");

  useEffect(() => {
    // The route already fetched today's chart; only fan out when it could not.
    // (On the web this arrived as server-rendered `initialSlides`; the login
    // route's effect plays that part, and slides can land after mount here.)
    if (initialSlides.length >= 2) return;
    let alive = true;
    getTrendingSlides()
      .then((next) => {
        /* The empty state below is the fallback — keep it on failure. */
        if (alive && next.length) setFetched(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [initialSlides]);

  // Auto-advance unless the user paused it or asked for less motion.
  useEffect(() => {
    if (paused || slides.length < 2) return;
    if (reduced) return;
    const timer = setInterval(() => {
      setIndex((value) => (value + 1) % slides.length);
    }, 5200);
    return () => clearInterval(timer);
  }, [paused, slides.length, reduced]);

  const total = slides.length;
  const active = total ? index % total : 0;
  const current = total ? slides[active] : null;

  const go = (delta: number) => {
    if (total < 2) return;
    setIndex((value) => (value + delta + total) % total);
  };

  /** Every slide is mounted so the change is a crossfade rather than a swap. */
  const artwork = () => (
    <>
      {slides.map((slide, slideIndex) => (
        <Fade key={slide.id} active={slideIndex === active} duration={900}>
          <Image
            source={{ uri: slide.image }}
            contentFit="cover"
            style={StyleSheet.absoluteFill}
            accessibilityLabel={slideIndex === active ? `${slide.title} cover art` : undefined}
          />
        </Fade>
      ))}
      {current ? null : (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: surfaceSecondary,
            },
          ]}
        >
          {/* radial-gradient(surface-secondary → background) becomes a flat
              tint of its start colour — no radial surface in core RN. */}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: background, opacity: 0.7 }]} />
          <View style={{ opacity: 0.4 }}>
            <Icon name="music" size={20} color={muted} />
          </View>
        </View>
      )}
    </>
  );

  /** The outgoing cover, smeared behind the panel so it never cuts flat. */
  const bleed = () => (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {slides.map((slide, slideIndex) => (
        <Fade key={`bleed-${slide.id}`} active={slideIndex === active} duration={1200}>
          <Image
            source={{ uri: slide.image }}
            contentFit="cover"
            blurRadius={20}
            style={[StyleSheet.absoluteFill, { opacity: 0.3, transform: [{ scale: 1.1 }] }]}
          />
        </Fade>
      ))}
    </View>
  );

  const dots = () =>
    slides.map((slide, slideIndex) => (
      <Pressable
        key={slide.id}
        onPress={() => setIndex(slideIndex)}
        accessibilityRole="button"
        accessibilityLabel={slide.title}
        accessibilityState={{ selected: slideIndex === active }}
        style={{
          height: 4,
          width: slideIndex === active ? 16 : 4,
          borderRadius: 999,
          backgroundColor: slideIndex === active ? accent : muted,
          opacity: slideIndex === active ? 1 : 0.3,
        }}
      />
    ));

  return (
    <View
      accessible
      accessibilityLabel="Trending"
      className="relative overflow-hidden rounded-2xl border border-separator bg-surface"
    >
      {bleed()}
      <View className="relative flex-row items-center gap-3.5 p-3">
        <View
          className="relative size-20 flex-none overflow-hidden rounded-xl border border-white/10 bg-surface-secondary"
          style={{
            shadowColor: "#000",
            shadowOpacity: 0.35,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 12 },
            elevation: 8,
          }}
        >
          {artwork()}
        </View>
        <Text
          numberOfLines={1}
          className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground"
        >
          {current?.title ?? ""}
        </Text>
        <View className="flex-row flex-none items-center gap-1">
          <Pressable
            onPress={() => setPaused((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={paused ? "Resume the trending slides" : "Pause the trending slides"}
            accessibilityState={{ selected: paused }}
            className="size-8 items-center justify-center rounded-lg"
          >
            <Pause size={14} color={muted} />
          </Pressable>
          <Pressable
            onPress={() => go(-1)}
            disabled={total < 2}
            accessibilityRole="button"
            accessibilityLabel="Previous trending track"
            className="size-8 items-center justify-center rounded-lg"
            style={{ opacity: total < 2 ? 0.3 : 1 }}
          >
            <ChevronLeft size={16} color={muted} />
          </Pressable>
          <Pressable
            onPress={() => go(1)}
            disabled={total < 2}
            accessibilityRole="button"
            accessibilityLabel="Next trending track"
            className="size-8 items-center justify-center rounded-lg"
            style={{ opacity: total < 2 ? 0.3 : 1 }}
          >
            <ChevronRight size={16} color={muted} />
          </Pressable>
        </View>
      </View>
      {total ? (
        <View className="relative flex-row items-center justify-center gap-1 pb-2.5">{dots()}</View>
      ) : null}
    </View>
  );
}
