import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, Text, View } from "react-native";
import { ScrollView, type ScrollViewInstance } from "react-native";
import { Icon } from "@/components/ui/icons";
import { useMusicPlayer } from "@/components/providers/MusicPlayerProvider";
import {
  activeLineIndex,
  formatSeconds,
  type LyricLine,
  type LyricsBody,
  type LyricsResult,
} from "@/lib/lyrics";
import { lookupLyrics } from "@/lib/lrclib";
import type { Song } from "@/lib/saavn";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ *
 * The lrclib lookup runs DIRECT here: the web asked its own
 * /api/music/lyrics route (which wrapped lrclib + the LRC parser); the ported
 * @/lib/lrclib already does that work on-device, so the seed is built exactly
 * like the route built it — title/artist/album + duration ROUNDED — and its
 * LyricsOutcome maps onto the same four states the panel knew. The 24 h module
 * cache, the single-flight map and the "errors stay uncached" rule are
 * verbatim.
 *
 * The clock keeps its wall-clock anchoring: `performance.now()` exists in
 * Hermes (RN ≥ 0.73); a Date.now() twin guards any runtime that lacks it.
 * ------------------------------------------------------------------ */

/** Monotonic milliseconds — performance.now() with a Date.now() fallback. */
function monotonic(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** A track's lyrics run for a day — the provider's answer rarely changes. */
const TTL = 24 * 60 * 60 * 1000;

/** How long a hand on the wheel or the screen suspends the auto-scroll. */
const HOLD_MS = 5000;

/**
 * How far past the last `progress` reading the clock may reach on its own.
 * A stream that stalls mid-play costs at most this much early highlighting,
 * instead of running ahead for as long as it is silent.
 */
const REACH_MS = 700;

/** The longest glide to a new line. Short hops between neighbours finish sooner. */
const GLIDE_MS = 720;

/** easeInOutCubic: leaves gently, arrives gently, so lines never snap. */
function eased(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

/** Read per move, not once at mount — the setting can change while we sit here. */
function readsSteady(): boolean {
  // matchMedia has no native twin; the last reduce-motion report stands until
  // the panel remounts (the web re-reads on every move for the same reason
  // this reads a live flag).
  return reduceMotionFlag.current;
}
const reduceMotionFlag = { current: false };

/**
 * Lines near the one being sung stay readable, the rest recede.
 *
 * Only a handful of rows ever change value, so a line flip starts a couple of
 * fades rather than one per row.
 */
function spotlight(index: number, active: number): number {
  if (active < 0) return 0.75;
  const away = Math.abs(index - active);
  if (away === 0) return 1;
  return Math.max(0.34, 0.8 - (away - 1) * 0.1);
}

type LyricsState =
  | { kind: "ready"; result: LyricsResult }
  | { kind: "none" }
  | { kind: "instrumental" }
  /** A failed request, never cached: the Retry button is the recovery. */
  | { kind: "error" };

const store = new Map<string, { at: number; state: LyricsState }>();

function cachedState(id: string): LyricsState | undefined {
  const entry = store.get(id);
  return entry && Date.now() - entry.at < TTL ? entry.state : undefined;
}

/** Live request for one song id — a reopen during the fetch reuses it. */
const inflight = new Map<string, Promise<LyricsState>>();

/**
 * One lyrics lookup. A thrown failure (rate limit, outage) is never "this
 * song has no words", so the two states stay distinguishable — exactly what
 * the route handler signalled with its status codes.
 */
async function fetchLyrics(song: Song): Promise<LyricsState> {
  try {
    const outcome = await lookupLyrics({
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: Math.round(song.duration || 0),
    });
    if (outcome.status === "none") {
      return outcome.reason === "instrumental" ? { kind: "instrumental" } : { kind: "none" };
    }
    const result = outcome.result;
    if (result.body.kind === "timed" && result.body.lines.length >= 2) {
      return { kind: "ready", result };
    }
    if (result.body.kind === "plain" && result.body.stanzas.length) {
      return { kind: "ready", result };
    }
    return { kind: "none" };
  } catch {
    // A LyricsUpstreamError is an outage; anything else failed to answer.
    // Both read the same here: "not found" must not be cached for an error.
    return { kind: "error" };
  }
}

/* ------------------------------------------------------------------ *
 * The clock.
 * ------------------------------------------------------------------ */

/**
 * Which line is being sung, resolved on frames rather than on state ticks.
 *
 * `progress` lands about four times a second, so an index read straight off it
 * can light up a quarter of a second after the word arrives. The reading is
 * anchored to a wall clock instead and stretched between ticks at the player's
 * own rate, which puts every flip within a frame of its timestamp — and stops
 * stretching the moment the reading disagrees, so a seek or a stall cannot
 * compound.
 *
 * Nothing here changes the audio. `progress` is only read.
 */
function useLyricClock(id: string, lines: LyricLine[] | null): number {
  const { progress, playing, rate } = useMusicPlayer();

  const [shown, setShown] = useState<{ id: string; index: number } | null>(null);
  const anchor = useRef({ time: progress, wall: monotonic() });
  const last = useRef(-2);

  /* Every fresh reading re-bases the clock on the player's own number. */
  useEffect(() => {
    anchor.current = { time: progress, wall: monotonic() };
  }, [progress]);

  useEffect(() => {
    if (!lines?.length) return;
    last.current = -2;

    let handle = requestAnimationFrame(function step(now) {
      handle = requestAnimationFrame(step);
      const base = anchor.current;
      const reach = Math.min(REACH_MS, now - base.wall) / 1000;
      const index = activeLineIndex(lines, base.time + reach * (rate || 1) * (playing ? 1 : 0));
      if (index === last.current) return;
      last.current = index;
      setShown({ id, index });
    });
    return () => cancelAnimationFrame(handle);
  }, [id, lines, playing, rate]);

  // The cache answers for the current song; a landing from another seed is
  // ignored, and a frame of the derived value is invisible.
  return shown?.id === id ? shown.index : lines ? activeLineIndex(lines, progress) : -1;
}

/* ------------------------------------------------------------------ *
 * The rows.
 *
 * Split out and memoised because `progress` re-renders every consumer of the
 * player context about four times a second, and sixty lyric rows must not
 * reconcile at that rate — they change once per sung line. So this component
 * takes the active index as a prop and deliberately does not read the player
 * itself; that is the one rule keeping the list cheap.
 *
 * Scrolling: getBoundingClientRect/scrollTop → a ScrollView ref. Each row
 * reports its position through onLayout into a measurement map, the container
 * reports its viewport height the same way, and the centre maths
 * (`rowTop − (box − row)/2`, clamped to the content ceiling) is the web's,
 * pixel for pixel. The sub-pixel track transform has no twin — scrollTo takes
 * fractional offsets natively.
 * ------------------------------------------------------------------ */

interface RowRect {
  y: number;
  height: number;
}

const LyricsRows = memo(function LyricsRows({
  body,
  active,
  onSeek,
}: {
  body: LyricsBody;
  active: number;
  onSeek: (time: number) => void;
}) {
  const boxRef = useRef<ScrollViewInstance | null>(null);
  const rectsRef = useRef<RowRect[]>([]);
  const contentHeightRef = useRef(0);
  const viewportHeightRef = useRef(0);
  /** First paint and a tap-seek land where they are told; they do not travel. */
  const instantRef = useRef(true);
  const holdUntilRef = useRef(0);
  const [held, setHeld] = useState(false);

  /* Where the list actually sits, fractional — RN's scrollTo answers
   * fractions, so no remainder transform is needed. */
  const atRef = useRef(0);
  const frameRef = useRef(0);

  const timed = body.kind === "timed";
  const lines = timed ? body.lines : [];

  const centre = useCallback((index: number): number | null => {
    const rect = rectsRef.current[index];
    const box = viewportHeightRef.current;
    if (!rect || !box || index < 0) return null;

    /* The engine's own ceiling: the last lines have no content below them, so
     * they rest above the floor instead of dead centre, which is what every
     * player does and is still fully in view. */
    const room = Math.max(0, contentHeightRef.current - box);
    const target = rect.y - (box - rect.height) / 2;
    return Math.min(Math.max(target, 0), room);
  }, []);

  const paint = useCallback((value: number) => {
    atRef.current = value;
    boxRef.current?.scrollTo({ x: 0, y: value, animated: false });
  }, []);

  const move = useCallback(
    (index: number) => {
      if (index < 0 || Date.now() < holdUntilRef.current) return;
      const to = centre(index);
      if (to === null) return;

      const from = atRef.current;
      const distance = Math.abs(to - from);
      const settle = instantRef.current || readsSteady() || distance < 3;
      instantRef.current = false;
      if (settle) {
        paint(to);
        return;
      }

      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      const started = monotonic();
      const ms = Math.min(GLIDE_MS, 240 + distance * 1.5);
      const step = (now: number) => {
        const k = Math.min(1, (now - started) / ms);
        paint(from + (to - from) * eased(k));
        frameRef.current = k < 1 ? requestAnimationFrame(step) : 0;
      };
      frameRef.current = requestAnimationFrame(step);
    },
    [centre, paint]
  );

  /* A new set of words is a new list: start at the top and land, don't travel. */
  useEffect(() => {
    atRef.current = 0;
    instantRef.current = true;
    rectsRef.current = [];
    boxRef.current?.scrollTo({ x: 0, y: 0, animated: false });
  }, [body]);

  useEffect(() => {
    if (timed) move(active);
  }, [active, timed, move]);

  useEffect(() => {
    // Track the live reduce-motion answer (readsSteady's native twin).
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) reduceMotionFlag.current = value;
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      reduceMotionFlag.current = value;
    });
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    },
    []
  );

  /* Manual reading wins for a while. The wheel/keydown listeners of the web
   * collapse into touch: dragging the list (onScrollBeginDrag) or tapping a
   * line's container suspends the auto-scroll for HOLD_MS. */
  const hold = useCallback(() => {
    holdUntilRef.current = Date.now() + HOLD_MS;
    setHeld(true);
  }, []);

  const holdTimerRef = useRef(0);
  const armHold = useCallback(() => {
    hold();
    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      setHeld(false);
      holdUntilRef.current = 0;
    }, HOLD_MS) as unknown as number;
  }, [hold]);

  useEffect(() => () => clearTimeout(holdTimerRef.current), []);

  if (!timed) {
    return (
      <ScrollView
        className="mt-2 min-h-0 flex-1"
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        contentContainerStyle={{ paddingBottom: 8, gap: 14 }}
      >
        {body.stanzas.map((stanza, index) => (
          <Text key={index} className="text-[13px] leading-relaxed text-muted">
            {stanza}
          </Text>
        ))}
      </ScrollView>
    );
  }

  const resume = () => {
    holdUntilRef.current = 0;
    setHeld(false);
    clearTimeout(holdTimerRef.current);
    move(active);
  };

  return (
    <View className="relative mt-2 min-h-0 flex-1 flex-col">
      <ScrollView
        ref={boxRef}
        className="min-h-0 flex-1"
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        contentContainerStyle={{ paddingBottom: 8, gap: 2 }}
        onTouchStart={armHold}
        onScrollBeginDrag={armHold}
        onLayout={(event) => {
          viewportHeightRef.current = event.nativeEvent.layout.height;
        }}
        onContentSizeChange={(_w, h) => {
          contentHeightRef.current = h;
        }}
        accessibilityLabel="Lyrics"
      >
        <View className="flex-col gap-0.5">
          {lines.map((line, index) => (
            <Pressable
              key={`${line.start}-${index}`}
              accessibilityRole="button"
              onPress={() => {
                /* Tapping is a deliberate jump, so it overrides any hold. */
                holdUntilRef.current = 0;
                setHeld(false);
                clearTimeout(holdTimerRef.current);
                instantRef.current = true;
                onSeek(line.start);
              }}
              accessibilityLabel={formatSeconds(line.start)}
              onLayout={(event) => {
                const { y, height } = event.nativeEvent.layout;
                rectsRef.current[index] = { y, height };
              }}
              style={{ opacity: spotlight(index, active) }}
              className={cn(
                "block w-full rounded-md px-1.5 py-1 text-left",
                index === active ? "font-semibold text-foreground" : "text-muted"
              )}
            >
              <Text className="text-[13px] leading-relaxed">{line.text}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {held && active >= 0 ? (
        <View className="absolute inset-x-0 bottom-1 z-10 items-center">
          <Pressable
            accessibilityRole="button"
            onPress={resume}
            className="rounded-full border border-separator bg-surface-secondary/95 px-3 py-1"
          >
            <Text className="text-[11px] font-semibold text-foreground">Jump to current line</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

/**
 * Lyrics for whatever is playing, in the now playing card.
 *
 * The words come from lrclib through the ported lookup (the web ran them
 * through /api/music/lyrics), already parsed into timestamps, and the line
 * being sung is read off the player's own position — so the highlight can
 * never disagree with the audio, and a tap on any line seeks to it through the
 * same `seek` the progress bar uses. Between lines the list glides on frames
 * instead of jumping on state ticks.
 */
export function LyricsPanel({ song }: { song: Song }) {
  const { duration, seek } = useMusicPlayer();

  /* The cache answers while a result is fresh; state only carries what an
   * in-flight request lands with, so switching seeds needs no reset pass. */
  const [settled, setSettled] = useState<{ id: string; state: LyricsState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const state = settled?.id === song.id ? settled.state : cachedState(song.id);
  const loading = !state;

  useEffect(() => {
    if (state) return;

    let running = inflight.get(song.id);
    if (!running) {
      running = fetchLyrics(song).then((next) => {
        // An outage stays uncached, so the next look asks again.
        if (next.kind !== "error") store.set(song.id, { at: Date.now(), state: next });
        return next;
      });
      inflight.set(song.id, running);
      // The cleanup chain must not become a second, unhandled rejection.
      void running.catch(() => undefined).finally(() => inflight.delete(song.id));
    }

    let alive = true;
    running
      .then((next) => {
        if (alive) setSettled({ id: song.id, state: next });
      })
      .catch(() => {
        if (alive) setSettled({ id: song.id, state: { kind: "error" } });
      });
    return () => {
      alive = false;
    };
  }, [state, song, attempt]);

  const result = state?.kind === "ready" ? state.result : null;
  const body = result?.body ?? null;
  const lines = body?.kind === "timed" ? body.lines : null;
  const active = useLyricClock(song.id, lines);

  const onSeek = useCallback(
    (time: number) => {
      // The catalogue's runtime can sit a second off the real stream.
      seek(Math.max(0, Math.min(time, duration || time)));
    },
    [seek, duration]
  );

  const retry = () => {
    store.delete(song.id);
    setSettled(null);
    setAttempt((value) => value + 1);
  };

  const subtitle = loading
    ? "Looking up the words"
    : state?.kind === "none"
      ? "Nothing found for this track"
      : state?.kind === "instrumental"
        ? "No vocals on this one"
        : state?.kind === "error"
          ? "The lyrics service didn’t answer"
          : result?.drift
            ? "Sync comes from a longer version — lines may drift"
            : result?.body.kind === "plain"
              ? "Timing unavailable for this version"
              : `Matched ${result?.matched.artistName || song.artist} · ${formatSeconds(result?.matched.duration || 0)}`;

  const failed = state?.kind === "none" || state?.kind === "error";

  return (
    <View className="mt-5 min-h-0 flex-1 flex-col">
      <View className="flex-row flex-none items-center gap-2">
        <View className="min-w-0">
          <Text className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
            Lyrics
          </Text>
          <Text numberOfLines={1} className="truncate pt-0.5 text-[11px] text-faint-foreground">
            {subtitle}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={retry}
          disabled={loading}
          accessibilityLabel="Look up the lyrics again"
          className="ml-auto size-9 flex-none items-center justify-center rounded-full border border-separator text-muted transition-colors active:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <Icon name="refresh" className="size-4" />
        </Pressable>
      </View>

      {loading ? (
        <View className="mt-3 flex-col gap-2.5">
          {[80, 60, 72, 55, 66].map((width, index) => (
            <View
              key={index}
              className="animate-pulse h-3.5 rounded bg-surface-secondary"
              style={{ width: `${width}%` }}
            />
          ))}
        </View>
      ) : body ? (
        <LyricsRows body={body} active={active} onSeek={onSeek} />
      ) : (
        <View className="mt-3 flex-col items-start gap-2 rounded-lg border border-separator bg-surface px-3 py-3">
          <View className="flex-row items-center gap-2">
            <Icon
              name={state?.kind === "instrumental" ? "music" : "mic"}
              className="size-4 text-muted"
            />
            <Text className="text-[13px] font-semibold text-foreground">
              {state?.kind === "instrumental"
                ? "This one’s instrumental."
                : state?.kind === "error"
                  ? "Couldn’t reach the lyrics service."
                  : "No lyrics for this one yet."}
            </Text>
          </View>
          {state?.kind === "instrumental" ? null : (
            <>
              <Text className="text-[11px] leading-relaxed text-faint-foreground">
                {state?.kind === "error"
                  ? "It usually answers in a moment — nothing was cached, so trying again is safe."
                  : "The lyrics database hasn’t got this track. Instrumental and regional releases are often missing."}
              </Text>
              {failed ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={retry}
                  className="rounded-full bg-accent px-3 py-1 active:scale-95"
                >
                  <Text className="text-[11px] font-semibold text-accent-foreground">Retry</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      )}
    </View>
  );
}
