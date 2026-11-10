import { useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Slider } from "heroui-native";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Waveform } from "@/components/features/music/Waveform";
import { EqBars } from "@/components/features/music/EqBars";
import {
  EQ_BANDS,
  EQ_PRESETS,
  SPATIAL_MODES,
  useMusicPlayer,
  type EqPreset,
  type SpatialMode,
} from "@/components/providers/MusicPlayerProvider";
import { useLibrary } from "@/components/providers/LibraryProvider";
import { cn } from "@/lib/cn";

/** heroui hands Slider changes as `number | number[]` — we always ask one value. */
function sliderValue(value: number | number[]): number {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The persistent listening bar — the mobile transport.
 *
 * AppChrome mounts it permanently above every screen; it disappears with the
 * queue (`!current`). Two rows, exactly the web's phone layout:
 *   row 1 — cover · title/artist · queue position · shuffle/prev/play/next/repeat
 *           (the auto-feed sparkle stays beside shuffle),
 *   row 2 — seek slider with mm:ss at both ends · like · add · now-playing
 *           toggle · EQ chip · mute · volume.
 * Pressing the cover/text block opens the now-playing screen through the
 * player's own flag (state-controlled — there is no route to push).
 *
 * The desktop-only clusters (the strict 3-column grid, the xl console button,
 * the 2xl queue-position readout) are dropped: they are pointer-layout
 * affordances, and the dock's Mixer tab carries the console entry on mobile.
 * The `<input type=range>` trio became heroui Sliders (step 1 s seek, step .05
 * volume), and `accentColor: var(--accent)` is what the library paints by
 * default. `env(safe-area-inset-bottom)` → useSafeAreaInsets.
 */
export function StickyPlayerBar() {
  const [eqOpen, setEqOpen] = useState(false);
  const [heavyPending, setHeavyPending] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const {
    queue,
    queueLabel,
    index,
    current,
    playing,
    progress,
    duration,
    volume,
    muted,
    playerError,
    visualizerReady,
    nowPlayingOpen,
    setNowPlayingOpen,
    eqPreset,
    eqGains,
    spatialMode,
    getAnalyser,
    togglePlay,
    stepTrack,
    seek,
    setVolume,
    setMuted,
    applyPreset,
    markEqCustom,
    setEqGains,
    setSpatialMode,
    shuffle,
    toggleShuffle,
    autoFeed,
    toggleAutoFeed,
    repeat,
    cycleRepeat,
  } = useMusicPlayer();

  const { isLiked, toggleLike, openPicker } = useLibrary();
  // (The web's only requireAuth gate in this file sat on the desktop-only
  // console button; the mobile console entry is the dock's Mixer tab, which
  // keeps its own requireAuth("mixer").)

  if (!current) return null;

  /** Live bars with the animated mimic when the analyser is kept away. */
  const renderWave = (className: string, tone: string) => (
    <View className={cn("items-center justify-center p-1", className)}>
      {visualizerReady ? (
        <Waveform
          getAnalyser={getAnalyser}
          active={playing}
          className="h-full w-full"
          color={tone === "text-white" ? "#ffffff" : undefined}
        />
      ) : (
        <EqBars color={tone === "text-white" ? "#ffffff" : undefined} />
      )}
    </View>
  );

  const transport = () => (
    <View className="flex-row items-center justify-center gap-0.5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Shuffle queue"
        accessibilityState={{ selected: shuffle }}
        onPress={toggleShuffle}
        hitSlop={4}
        className={cn(
          "size-9 items-center justify-center rounded-full transition-colors duration-150",
          shuffle
            ? "bg-accent-soft text-brand"
            : "text-muted active:bg-surface-secondary active:text-foreground"
        )}
      >
        <Icon name="shuffle" className="size-4" />
      </Pressable>
      {/* Taste-driven queue top-ups: keeps the shelf below the needle growing
          from the listener's own taste. Never touches which track comes next. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Auto recommendation feed"
        accessibilityState={{ selected: autoFeed }}
        onPress={toggleAutoFeed}
        hitSlop={4}
        className={cn(
          "size-9 items-center justify-center rounded-full transition-all duration-150",
          autoFeed
            ? "bg-accent-soft text-brand"
            : "text-muted active:bg-surface-secondary active:text-foreground"
        )}
      >
        <Icon name="sparkles" className="size-4" />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous track"
        onPress={() => stepTrack(-1)}
        disabled={index <= 0 && progress <= 3}
        hitSlop={4}
        className={cn(
          "size-9 items-center justify-center rounded-full text-muted transition-colors duration-150 active:bg-surface-secondary active:text-foreground disabled:pointer-events-none disabled:opacity-35"
        )}
      >
        <Icon name="skip-back" className="size-4 fill-current" />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? "Pause" : "Play"}
        onPress={togglePlay}
        className="size-11 items-center justify-center rounded-full bg-foreground text-background transition-transform duration-150 active:scale-95"
      >
        {playing ? (
          <Icon name="pause" className="size-4 fill-current" />
        ) : (
          <Icon name="play" className="translate-x-px size-4 fill-current" />
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next track"
        onPress={() => stepTrack(1)}
        hitSlop={4}
        className="size-9 items-center justify-center rounded-full text-muted transition-colors duration-150 active:bg-surface-secondary active:text-foreground"
      >
        <Icon name="skip-forward" className="size-4 fill-current" />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Repeat mode"
        accessibilityState={{ selected: repeat !== "off" }}
        onPress={cycleRepeat}
        hitSlop={4}
        className={cn(
          "relative size-9 items-center justify-center rounded-full transition-colors duration-150",
          repeat !== "off"
            ? "bg-accent-soft text-brand"
            : "text-muted active:bg-surface-secondary active:text-foreground"
        )}
      >
        <Icon name="repeat" className="size-4" />
        {repeat !== "off" ? (
          <Text className="absolute bottom-0.5 left-1/2 -translate-x-1/2 font-mono text-[7px] font-black uppercase tracking-widest">
            {repeat === "all" ? "all" : "1"}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );

  const seekRow = (
    <View className="flex-row min-w-0 flex-1 items-center gap-2">
      <Text className="w-9 flex-none text-right text-[10px] font-semibold tabular-nums text-muted-foreground">
        {formatSeconds(progress)}
      </Text>
      <Slider
        value={[duration ? Math.min(progress, duration) : 0]}
        minValue={0}
        maxValue={Math.max(duration, 1)}
        step={1}
        aria-label="Seek"
        onChange={(values) => seek(sliderValue(values))}
        className="min-w-0 flex-1"
      >
        <Slider.Track className="h-1.5 rounded-full">
          <Slider.Fill className="rounded-full" />
          <Slider.Thumb className="size-3.5" />
        </Slider.Track>
      </Slider>
      <Text className="w-9 flex-none text-[10px] font-semibold tabular-nums text-muted-foreground">
        {formatSeconds(duration)}
      </Text>
    </View>
  );

  /** Heavy-duty profiles need a hearing-safety confirmation before they engage. */
  const choosePreset = (preset: EqPreset) => {
    if (preset.heavy && eqPreset !== preset.label) {
      setHeavyPending(preset.label);
      return;
    }
    applyPreset(preset);
  };

  const eqChipActive = eqOpen || eqPreset !== EQ_PRESETS[0].label || spatialMode !== "off";

  return (
    <>
      <View pointerEvents="box-none" className="absolute inset-x-0 bottom-0 z-40">
        <View
          pointerEvents="box-none"
          className="mx-auto w-full max-w-[100rem] px-3"
          style={{ paddingBottom: Math.max(12, insets.bottom) }}
        >
          {/* Equalizer + space panel floats above the bar. */}
          {eqOpen ? (
            <ScrollView
              className="max-h-[72%] rounded-t-field border border-b-0 border-separator bg-surface px-4 pb-3 pt-3 shadow-pop"
              showsVerticalScrollIndicator={false}
            >
              <View className="flex-row items-center justify-between gap-2 pb-2.5">
                <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Equalizer
                </Text>
                <View className="flex-row flex-1 items-center gap-3">
                  {visualizerReady ? (
                    <View className="h-4 w-24">{renderWave("h-full w-full", "text-brand")}</View>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setEqOpen(false)}
                    className="min-h-8 px-1"
                  >
                    <Text className="text-[11px] font-semibold text-muted active:text-foreground">
                      Close ✕
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* Presets */}
              <View className="flex-row flex-wrap gap-1.5">
                {EQ_PRESETS.map((preset) => (
                  <Pressable
                    key={preset.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected: eqPreset === preset.label }}
                    onPress={() => choosePreset(preset)}
                    className={cn(
                      "min-h-8 rounded-full border px-3 items-center justify-center",
                      eqPreset === preset.label
                        ? "border-transparent bg-accent"
                        : "border-separator bg-surface"
                    )}
                  >
                    <Text
                      className={cn(
                        "text-xs font-semibold",
                        eqPreset === preset.label ? "text-accent-foreground" : "text-muted"
                      )}
                    >
                      {preset.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Bands — the phone layout stacks them one under another. */}
              <View className="flex-col gap-2.5 pt-3">
                {EQ_BANDS.map((band, bandIndex) => (
                  <View key={band.frequency} className="flex-row items-center gap-2">
                    <Text className="w-8 shrink-0 text-[11px] font-medium text-muted">
                      {band.label}
                    </Text>
                    <Slider
                      value={[eqGains[bandIndex]]}
                      minValue={-12}
                      maxValue={12}
                      step={0.5}
                      aria-label={`${band.label} Hz gain`}
                      onChange={(values) => {
                        const gains = [...eqGains];
                        gains[bandIndex] = sliderValue(values);
                        setEqGains(gains);
                        markEqCustom(gains);
                      }}
                      className="min-w-0 flex-1"
                    >
                      <Slider.Track className="h-1.5 rounded-full">
                        <Slider.Fill className="rounded-full" />
                        <Slider.Thumb className="size-3.5" />
                      </Slider.Track>
                    </Slider>
                    <Text className="w-11 shrink-0 text-right text-[11px] tabular-nums text-muted">
                      {eqGains[bandIndex] > 0 ? "+" : ""}
                      {eqGains[bandIndex].toFixed(1)}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Space modes */}
              <View className="mt-3.5 border-t border-separator pt-3">
                <Text className="pb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Space
                </Text>
                <View className="flex-row flex-wrap gap-1.5">
                  {SPATIAL_MODES.map((mode) => (
                    <Pressable
                      key={mode.value}
                      accessibilityRole="button"
                      accessibilityLabel={mode.hint}
                      accessibilityState={{ selected: spatialMode === mode.value }}
                      onPress={() => setSpatialMode(mode.value as SpatialMode)}
                      className={cn(
                        "min-h-8 rounded-full border px-3 items-center justify-center",
                        spatialMode === mode.value
                          ? "border-transparent bg-accent"
                          : "border-separator bg-surface"
                      )}
                    >
                      <Text
                        className={cn(
                          "text-xs font-semibold",
                          spatialMode === mode.value ? "text-accent-foreground" : "text-muted"
                        )}
                      >
                        {mode.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </ScrollView>
          ) : null}

          <View className="rounded-t-field border border-b-0 border-separator bg-surface/95 p-2.5 shadow-pop">
            {/* ── Row 1 = cover · title · transport ───────────────────── */}
            <View className="flex-row items-center gap-2.5">
              <Pressable
                accessibilityRole="button"
                onPress={() => setNowPlayingOpen(true)}
                accessibilityLabel="Open the now playing screen"
                className="flex-row min-w-0 flex-1 items-center gap-2.5"
              >
                <View className="relative size-11 flex-none overflow-hidden rounded-lg bg-surface-muted">
                  {current.image ? (
                    <Image
                      source={{ uri: current.image }}
                      className="size-full"
                      resizeMode="cover"
                    />
                  ) : (
                    <View className="h-full items-center justify-center text-faint-foreground">
                      <Icon name="music" className="size-5" />
                    </View>
                  )}
                  {playing ? renderWave("absolute inset-0", "text-white") : null}
                </View>
                <View className="min-w-0 flex-1">
                  <Text
                    numberOfLines={1}
                    className="truncate text-sm font-semibold text-foreground"
                  >
                    {current.title}
                  </Text>
                  <Text numberOfLines={1} className="truncate text-xs text-muted">
                    {queueLabel ? `${queueLabel} · ` : ""}
                    {current.artist}
                  </Text>
                  {/* Queue position stays visible on phones too. */}
                  <Text className="text-[10px] font-medium tabular-nums text-faint-foreground">
                    {index + 1} / {queue.length}
                    {playerError ? " · stream retry needed" : ""}
                  </Text>
                </View>
              </Pressable>
              {transport()}
            </View>
            {/* ── Row 2 = seek + extras ──────────────────────────────── */}
            <View className="mt-2 flex-row items-center gap-2">
              {seekRow}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isLiked(current) ? "Remove from Liked songs" : "Like this song"}
                accessibilityState={{ selected: isLiked(current) }}
                onPress={() => toggleLike(current)}
                className="size-9 flex-none items-center justify-center rounded-full"
              >
                <Icon
                  name="heart"
                  className={cn(
                    "size-4",
                    isLiked(current) ? "fill-current text-danger" : "text-muted"
                  )}
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add this song to a playlist"
                onPress={() => openPicker(current)}
                className="size-9 flex-none items-center justify-center rounded-full text-muted"
              >
                <Icon name="plus" className="size-4" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Toggle the now playing side panel"
                accessibilityState={{ selected: nowPlayingOpen }}
                onPress={() => setNowPlayingOpen(!nowPlayingOpen)}
                className={cn(
                  "size-9 flex-none items-center justify-center rounded-full border",
                  nowPlayingOpen
                    ? "border-accent/40 bg-accent-soft text-brand"
                    : "border-separator text-muted"
                )}
              >
                <Icon name="sidebar" className="size-4" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Equalizer and space modes"
                onPress={() => setEqOpen((open) => !open)}
                className={cn(
                  "flex h-9 flex-none items-center gap-1 rounded-full border px-2.5",
                  eqChipActive ? "border-accent/40 bg-accent-soft" : "border-separator"
                )}
              >
                <Icon
                  name="sliders"
                  className={cn("size-3.5", eqChipActive ? "text-brand" : "text-muted")}
                />
                <Text
                  className={cn(
                    "text-[11px] font-bold",
                    eqChipActive ? "text-brand" : "text-muted"
                  )}
                >
                  EQ
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={muted ? "Unmute" : "Mute"}
                onPress={() => setMuted(!muted)}
                className="size-9 flex-none items-center justify-center rounded-full text-muted"
              >
                {muted ? (
                  <Icon name="volume-x" className="size-4" />
                ) : (
                  <Icon name="volume-2" className="size-4" />
                )}
              </Pressable>
              <Slider
                value={[volume]}
                minValue={0}
                maxValue={1}
                step={0.05}
                aria-label="Volume"
                onChange={(values) => setVolume(sliderValue(values))}
                className="w-16"
              >
                <Slider.Track className="h-1.5 rounded-full">
                  <Slider.Fill className="rounded-full" />
                  <Slider.Thumb className="size-3" />
                </Slider.Track>
              </Slider>
            </View>
            {playerError ? (
              <Text className="mt-1 truncate text-[11px] text-danger">{playerError}</Text>
            ) : null}
          </View>
        </View>
      </View>

      {/* Heavy-preset hearing-safety confirmation — copy kept verbatim. */}
      <ConfirmDialog
        open={heavyPending !== null}
        title={`${heavyPending ?? ""} — ear check`}
        description={
          "This profile pushes the low frequencies hard — made for large speaker stacks " +
          "(party PA systems, tourist-bus subwoofers). Extended listening at high volume — " +
          "especially in enclosed spaces — can permanently damage your hearing, and big " +
          "driver excursion can stress small speakers. Keep the volume as loud as it needs " +
          "to be — no louder."
        }
        confirmLabel={`Enable ${(heavyPending ?? "").toLowerCase()}`}
        destructive
        onCancel={() => setHeavyPending(null)}
        onConfirm={() => {
          applyPreset(EQ_PRESETS.find((preset) => preset.label === heavyPending) ?? EQ_PRESETS[0]);
          setHeavyPending(null);
        }}
      />
    </>
  );
}

function formatSeconds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
