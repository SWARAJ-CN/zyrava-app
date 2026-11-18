import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, Text, View } from "react-native";
import { ScrollView, type ScrollViewInstance } from "react-native";
import { Icon } from "@/components/ui/icons";
import {
  useMusicPlayer,
  usePlaybackProgress,
  useKaraokePreparationProgress,
} from "@/components/providers/MusicPlayerProvider";
import { activeLineIndex, formatSeconds, type LyricLine, type LyricsBody } from "@/lib/lyrics";
import { cachedLyrics, loadLyrics, invalidateLyrics, type LyricsState } from "@/lib/lyrics-cache";
import type { Song } from "@/lib/saavn";
import { cn } from "@/lib/cn";
import { Modal } from "@/components/ui/Modal";
import { LyricLineMotion } from "./LyricLineMotion";
import { LYRIC_LANGUAGES, type LyricLanguage } from "@/lib/lyric-translation";
import { useLyricTranslation } from "@/hooks/useLyricTranslation";

/* ------------------------------------------------------------------ *
 * The lrclib adapter uses the configured web /api/music/lyrics route, or does
 * the same lookup on-device when no web origin is configured. The seed is
 * built like the web panel's — title/artist/album + duration ROUNDED — and its
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

/** How long a hand on the wheel or the screen suspends the auto-scroll. */
const HOLD_MS = 3000;

/**
 * How far past the last `progress` reading the clock may reach on its own.
 * A stream that stalls mid-play costs at most this much early highlighting,
 * instead of running ahead for as long as it is silent.
 */
const REACH_MS = 700;

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
  const { playing, rate } = useMusicPlayer();
  const { progress } = usePlaybackProgress();

  const [shown, setShown] = useState<{ id: string; index: number } | null>(null);
  const anchor = useRef({ time: progress, wall: monotonic() });
  const last = useRef(-2);

  /* Every fresh reading re-bases the clock on the player's own number. */
  useEffect(() => {
    anchor.current = { time: progress, wall: monotonic() };
  }, [progress, playing, rate, id]);

  useEffect(() => {
    if (!lines?.length || !playing) return;
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
  if (!playing) return lines ? activeLineIndex(lines, progress) : -1;
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
  translations,
  large = false,
}: {
  body: LyricsBody;
  large?: boolean;
  translations?: string[];
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
  const activeRef = useRef(active);
  useLayoutEffect(() => {
    activeRef.current = active;
  }, [active]);

  /* Where the list actually sits, fractional — RN's scrollTo answers
   * fractions, so no remainder transform is needed. */
  const atRef = useRef(0);

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

  const move = useCallback(
    (index: number) => {
      if (index < 0 || Date.now() < holdUntilRef.current) return;
      const to = centre(index);
      if (to === null) return;
      const animated = !instantRef.current && !readsSteady() && Math.abs(to - atRef.current) >= 3;
      instantRef.current = false;
      // The native scroll view owns the glide: no per-frame JS scroll commands.
      boxRef.current?.scrollTo({ x: 0, y: to, animated });
    },
    [centre]
  );

  /* A new set of words is a new list: start at the top and land, don't travel. */
  useLayoutEffect(() => {
    atRef.current = 0;
    instantRef.current = true;
    rectsRef.current = [];
    boxRef.current?.scrollTo({ x: 0, y: 0, animated: false });
  }, [body]);

  useEffect(() => {
    if (timed && !held) move(active);
  }, [active, timed, held, move]);

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

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestures = useRef({ touch: false, drag: false, momentum: false });
  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  }, []);
  const resume = useCallback(() => {
    clearHoldTimer();
    gestures.current = { touch: false, drag: false, momentum: false };
    holdUntilRef.current = 0;
    setHeld(false);
    // Read the current line at timeout time, including during long lyric lines.
    move(activeRef.current);
  }, [clearHoldTimer, move]);
  const beginReading = useCallback(
    (kind: "touch" | "drag" | "momentum") => {
      gestures.current[kind] = true;
      clearHoldTimer();
      holdUntilRef.current = Infinity;
      setHeld(true);
      if (kind === "touch") boxRef.current?.scrollTo({ x: 0, y: atRef.current, animated: false });
    },
    [clearHoldTimer]
  );
  const finishReading = useCallback(
    (kind: "touch" | "drag" | "momentum") => {
      if (!gestures.current[kind]) return;
      gestures.current[kind] = false;
      if (Object.values(gestures.current).some(Boolean)) return;
      clearHoldTimer();
      holdUntilRef.current = Date.now() + HOLD_MS;
      holdTimerRef.current = setTimeout(resume, HOLD_MS);
    },
    [clearHoldTimer, resume]
  );
  useEffect(() => clearHoldTimer, [clearHoldTimer]);

  if (!timed) {
    return (
      <ScrollView
        className="mt-2 min-h-0 flex-1"
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 24, gap: 22 }}
      >
        {body.stanzas.map((stanza, index) => (
          <View key={index} className="gap-1">
            <Text className="text-xl font-semibold leading-8 text-foreground">{stanza}</Text>
            {translations?.[index] ? (
              <Text
                className="text-[13px] leading-relaxed text-foreground"
                style={{ writingDirection: "auto" }}
              >
                {translations[index]}
              </Text>
            ) : null}
          </View>
        ))}
      </ScrollView>
    );
  }

  return (
    <View className="relative mt-2 min-h-0 flex-1 flex-col">
      <ScrollView
        ref={boxRef}
        className="min-h-0 flex-1"
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        contentContainerStyle={{ paddingBottom: 48, gap: 2 }}
        onTouchStart={() => beginReading("touch")}
        onTouchEnd={() => finishReading("touch")}
        onTouchCancel={() => {
          // A cancelled responder may never emit drag/momentum-end events.
          gestures.current = { touch: true, drag: false, momentum: false };
          finishReading("touch");
        }}
        onScrollBeginDrag={() => beginReading("drag")}
        onScrollEndDrag={() => finishReading("drag")}
        onMomentumScrollBegin={() => beginReading("momentum")}
        onMomentumScrollEnd={() => finishReading("momentum")}
        onLayout={(event) => {
          viewportHeightRef.current = event.nativeEvent.layout.height;
          move(active);
        }}
        onContentSizeChange={(_w, h) => {
          contentHeightRef.current = h;
          move(active);
        }}
        onScroll={(event) => {
          atRef.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
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
                clearHoldTimer();
                gestures.current = { touch: false, drag: false, momentum: false };
                instantRef.current = true;
                onSeek(line.start);
              }}
              accessibilityLabel={`${line.text}, ${formatSeconds(line.start)}`}
              accessibilityState={{ selected: index === active }}
              onLayout={(event) => {
                const { y, height } = event.nativeEvent.layout;
                rectsRef.current[index] = { y, height };
                if (index === active) move(active);
              }}
              className={cn("w-full py-3 pr-2", index === active ? "opacity-100" : "opacity-90")}
            >
              <LyricLineMotion opacity={spotlight(index, active)} active={index === active}>
                <Text
                  className={cn(
                    large ? "text-[30px] leading-[42px]" : "text-[22px] leading-8",
                    index === active ? "font-bold text-foreground" : "font-semibold text-muted"
                  )}
                >
                  {line.text}
                </Text>
                {translations?.[index] ? (
                  <Text
                    className="mt-1 text-[13px] leading-relaxed text-foreground"
                    style={{ writingDirection: "auto" }}
                  >
                    {translations[index]}
                  </Text>
                ) : null}
              </LyricLineMotion>
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
 * same `seek` the progress bar uses. Between lines the native scroll view glides
 * while the UI thread animates each line’s emphasis.
 */
export function LyricsPanel({ song, large = false }: { song: Song; large?: boolean }) {
  const {
    seek,
    karaokeOn,
    karaokeAvailable,
    karaokePreparing,
    karaokeError,
    setKaraoke,
    karaokeSelecting,
    instrumentalName,
    instrumentalPlaying,
    chooseInstrumental,
  } = useMusicPlayer();
  const { duration } = usePlaybackProgress();
  const karaokeProgress = useKaraokePreparationProgress();
  const karaokePercent = karaokeProgress?.percent ?? 0;
  const karaokeStage = {
    starting: "Starting",
    downloading: "Downloading audio",
    reading: "Loading audio",
    decoding: "Decoding audio",
    processing: "Reducing vocals",
    saving: "Saving audio",
    ready: "Ready",
  }[karaokeProgress?.stage ?? "starting"];

  /* The cache answers while a result is fresh; state only carries what an
   * in-flight request lands with, so switching seeds needs no reset pass. */
  const [settled, setSettled] = useState<{ id: string; state: LyricsState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const state = settled?.id === song.id ? settled.state : cachedLyrics(song.id);
  const loading = !state;

  useEffect(() => {
    if (state) return;

    const running = loadLyrics(song);

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
  const [language, setLanguage] = useState<LyricLanguage | null>(null);
  const [languagesOpen, setLanguagesOpen] = useState(false);
  const translation = useLyricTranslation(body, language, song.language);
  const languageName = LYRIC_LANGUAGES.find(([code]) => code === language)?.[1];

  const onSeek = useCallback(
    (time: number) => {
      // The catalogue's runtime can sit a second off the real stream.
      seek(Math.max(0, Math.min(time, duration || time)));
    },
    [seek, duration]
  );

  const retry = () => {
    invalidateLyrics(song.id);
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
    <View className="mt-3 min-h-0 flex-1 flex-col">
      <View style={{ flexShrink: 0, gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <Text className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
            {body?.kind === "timed" ? "Synced" : "Lyrics"}
          </Text>
          <View style={{ flex: 1 }} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Karaoke mode"
            accessibilityHint="Reduce vocals in the current song without restarting playback."
            accessibilityState={{
              selected: karaokeOn,
              disabled: !karaokeAvailable || karaokeSelecting,
              busy: karaokeSelecting,
            }}
            disabled={!karaokeAvailable || karaokeSelecting}
            onPress={() => setKaraoke(!karaokeOn)}
            style={{
              minHeight: 40,
              flexShrink: 0,
              justifyContent: "center",
              paddingHorizontal: 12,
            }}
            className={cn(
              "rounded-full active:opacity-80",
              karaokeOn ? "bg-foreground" : "bg-surface-secondary",
              !karaokeAvailable && "opacity-50"
            )}
          >
            <Text
              className={cn(
                "text-xs font-semibold",
                karaokeOn ? "text-background" : "text-foreground"
              )}
            >
              {karaokeSelecting
                ? "Choosing audio…"
                : karaokePreparing
                  ? `Preparing ${karaokePercent}%`
                  : karaokeOn
                    ? "Karaoke on"
                    : "Karaoke"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Translate lyrics"
            accessibilityState={{ expanded: languagesOpen }}
            onPress={() => setLanguagesOpen(true)}
            style={{
              minHeight: 40,
              flexShrink: 0,
              justifyContent: "center",
              paddingHorizontal: 14,
            }}
            className="rounded-full bg-accent-soft active:opacity-80"
          >
            <Text className="text-xs font-semibold text-accent-soft-foreground">Translate</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={retry}
            disabled={loading}
            accessibilityLabel="Look up the lyrics again"
            className="ml-auto size-11 flex-none items-center justify-center text-muted transition-colors active:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <Icon name="refresh" className="size-4" />
          </Pressable>
        </View>
        <Text numberOfLines={1} className="text-[11px] text-faint-foreground">
          {languageName ? `${languageName} · ${subtitle}` : subtitle}
        </Text>
      </View>

      {karaokeError || !karaokeAvailable || karaokeOn ? (
        <Text accessibilityLiveRegion="polite" className="mt-2 text-[11px] text-muted">
          {karaokeError ??
            (!karaokeAvailable
              ? "Karaoke processing is unavailable on this player."
              : karaokePreparing
                ? `${karaokeStage} · ${karaokePercent}% overall. Original audio keeps playing. Tap Karaoke to cancel.`
                : instrumentalPlaying
                  ? `Playing instrumental: ${instrumentalName ?? "Selected file"}.`
                  : "Reducing vocals in the current song. Some vocals may remain and instruments may sound quieter.")}
        </Text>
      ) : null}
      {!karaokeOn && instrumentalName ? (
        <Text className="mt-2 text-[11px] text-muted">
          A saved instrumental is available. Karaoke uses the current song unless you choose a file.
        </Text>
      ) : null}
      {instrumentalName || karaokeOn ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose instrumental file"
          disabled={karaokeSelecting}
          onPress={() => void chooseInstrumental()}
          className="min-h-10 self-start justify-center py-2"
        >
          <Text className="text-xs text-foreground">Use an instrumental file</Text>
        </Pressable>
      ) : null}
      {karaokePreparing ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={`Karaoke preparation: ${karaokeStage}`}
          accessibilityValue={{ min: 0, max: 100, now: karaokePercent }}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-secondary"
        >
          <View
            className="h-full rounded-full bg-foreground"
            style={{ width: `${karaokePercent}%` }}
          />
        </View>
      ) : null}
      {translation.status === "loading" ? (
        <Text accessibilityLiveRegion="polite" className="mt-2 text-xs text-muted">
          Translating to {languageName}…
        </Text>
      ) : translation.status === "error" ? (
        <View className="mt-2 flex-row items-center gap-2">
          <Text accessibilityLiveRegion="polite" className="flex-1 text-xs text-muted">
            {translation.error || "Translation unavailable."} Original lyrics are still shown.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry lyric translation"
            onPress={translation.retry}
            className="min-h-10 justify-center px-2"
          >
            <Text className="text-xs font-semibold text-brand">Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {languagesOpen ? (
        <Modal
          open
          onClose={() => setLanguagesOpen(false)}
          title="Translate lyrics"
          isSwipeable={false}
          description="Choose a language"
          size="sm"
        >
          {([[null, "Original only"], ...LYRIC_LANGUAGES] as const).map(([code, label]) => (
            <Pressable
              key={code ?? "off"}
              accessibilityRole="button"
              accessibilityState={{ selected: language === code }}
              onPress={() => {
                setLanguage(code);
                setLanguagesOpen(false);
              }}
              className={cn(
                "min-h-11 justify-center rounded-lg px-3",
                language === code && "bg-accent-soft"
              )}
            >
              <Text
                className={cn(
                  "text-sm",
                  language === code ? "font-semibold text-brand" : "text-foreground"
                )}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </Modal>
      ) : null}
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
        <LyricsRows
          key={song.id}
          body={body}
          active={active}
          onSeek={onSeek}
          translations={translation.rows}
          large={large}
        />
      ) : (
        <View className="min-h-0 flex-1 items-start justify-center gap-3 py-6">
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
