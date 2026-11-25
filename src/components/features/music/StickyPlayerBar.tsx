import { useCustomization } from "@/components/providers/CustomizationProvider";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Slider } from "heroui-native";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Waveform } from "@/components/features/music/Waveform";
import { PlaybackSeekBar } from "./PlaybackSeekBar";
import { EqBars } from "@/components/features/music/EqBars";
import {
  EQ_BANDS,
  EQ_PRESETS,
  SPATIAL_MODES,
  useMusicPlayer,
  usePlaybackProgress,
  type EqPreset,
  type SpatialMode,
} from "@/components/providers/MusicPlayerProvider";
import { useLibrary } from "@/components/providers/LibraryProvider";
import { cn } from "@/lib/cn";

/** heroui hands Slider changes as `number | number[]` — we always ask one value. */
function sliderValue(value: number | number[]): number {
  return Array.isArray(value) ? value[0] : value;
}

/** Phone transport: song details and corner actions above playback and seeking. */
export function StickyPlayerBar() {
  const { personal } = useCustomization();
  const [eqOpen, setEqOpen] = useState(false);
  const [heavyPending, setHeavyPending] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const {
    queue,
    queueLabel,
    index,
    current,
    playing,
    loading,
    playerError,
    processingError,
    visualizerReady,
    nowPlayingOpen,
    setNowPlayingOpen,
    eqPreset,
    eqGains,
    spatialMode,
    getAnalyser,
    getGraphInfo,
    togglePlay,
    stepTrack,
    seek,
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
  const { progress, duration } = usePlaybackProgress();
  const graph = getGraphInfo();
  const eqSupported = graph.equalizer ?? graph.webAudio;
  const spaceSupported = graph.spatial ?? graph.webAudio;

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
        <Icon name="shuffle" className={cn("size-4", shuffle ? "text-brand" : "text-muted")} />
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
        <Icon name="sparkles" className={cn("size-4", autoFeed ? "text-brand" : "text-muted")} />
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
        <Icon name="skip-back" className="size-4 fill-current text-muted" />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? "Pause" : "Play"}
        onPress={togglePlay}
        className="size-11 items-center justify-center rounded-full bg-foreground text-background transition-transform duration-150 active:scale-95"
      >
        {loading ? (
          <ActivityIndicator size="small" accessibilityLabel="Loading audio" />
        ) : playing ? (
          <Icon name="pause" className="size-4 fill-current text-background" />
        ) : (
          <Icon name="play" className="translate-x-px size-4 fill-current text-background" />
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next track"
        onPress={() => stepTrack(1)}
        hitSlop={4}
        className="size-9 items-center justify-center rounded-full text-muted transition-colors duration-150 active:bg-surface-secondary active:text-foreground"
      >
        <Icon name="skip-forward" className="size-4 fill-current text-muted" />
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
        <Icon
          name="repeat"
          className={cn("size-4", repeat !== "off" ? "text-brand" : "text-muted")}
        />
        {repeat !== "off" ? (
          <Text className="absolute bottom-0.5 left-1/2 -translate-x-1/2 font-mono text-[7px] font-black uppercase tracking-widest text-brand">
            {repeat === "all" ? "all" : "1"}
          </Text>
        ) : null}
      </Pressable>
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
        <View pointerEvents="box-none" className="w-full px-2">
          {/* Equalizer + space panel floats above the bar. */}
          {eqOpen && !personal ? (
            <ScrollView
              style={{ maxHeight: height * 0.55 }}
              className=" rounded-t-field border border-b-0 border-separator bg-surface px-4 pb-3 pt-3 shadow-pop"
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

              {!eqSupported ? (
                <Text className="mb-3 text-xs leading-5 text-muted">
                  Starting audio effects. If controls stay unavailable, reload the app and update
                  Android System WebView.
                </Text>
              ) : null}

              {eqSupported && !graph.webAudio ? (
                <Text className="mb-3 text-xs leading-5 text-muted">
                  EQ and Space · keep the app open. Changes apply to the playing track.
                </Text>
              ) : null}
              {/* Presets */}
              <View className="flex-row flex-wrap gap-1.5">
                {EQ_PRESETS.map((preset) => (
                  <Pressable
                    key={preset.label}
                    accessibilityRole="button"
                    disabled={!eqSupported}
                    accessibilityState={{
                      selected: eqPreset === preset.label,
                      disabled: !eqSupported,
                    }}
                    onPress={() => choosePreset(preset)}
                    className={cn(
                      "min-h-8 rounded-full border px-3 items-center justify-center",
                      !eqSupported && "opacity-40",
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

              {processingError ? (
                <Text accessibilityRole="alert" className="pt-2 text-xs text-danger">
                  {processingError}
                </Text>
              ) : null}
              {/* Bands — the phone layout stacks them one under another. */}
              <View className="flex-col gap-2.5 pt-3">
                {EQ_BANDS.map((band, bandIndex) => (
                  <View key={band.frequency} className="flex-row items-center gap-2">
                    <Text className="w-8 shrink-0 text-[11px] font-medium text-muted">
                      {band.label}
                    </Text>
                    <Slider
                      isDisabled={!eqSupported}
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
                {!spaceSupported ? (
                  <Text className="mb-2 text-xs text-muted">
                    Space is unavailable while the effects player is starting or recovering.
                  </Text>
                ) : null}
                <View className="flex-row flex-wrap gap-1.5">
                  {SPATIAL_MODES.map((mode) => (
                    <Pressable
                      key={mode.value}
                      accessibilityRole="button"
                      disabled={!spaceSupported}
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

          <View
            className="rounded-t-field border border-b-0 border-separator bg-surface p-2.5 shadow-pop"
            style={{ paddingBottom: Math.max(10, insets.bottom) }}
          >
            {/* Song details on the left; secondary actions at the upper-right. */}
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
                      <Icon name="music" className="size-5 text-faint-foreground" />
                    </View>
                  )}
                  {loading ? (
                    <View className="absolute inset-0 items-center justify-center bg-black/45">
                      <ActivityIndicator
                        size="small"
                        color="#fff"
                        accessibilityLabel="Loading audio"
                      />
                    </View>
                  ) : playing ? (
                    renderWave("absolute inset-0", "text-white")
                  ) : null}
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
                    {loading ? " · Loading…" : playerError ? " · stream retry needed" : ""}
                  </Text>
                </View>
              </Pressable>
              <View className="shrink-0 flex-row items-center">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    isLiked(current) ? "Remove from Liked songs" : "Like this song"
                  }
                  accessibilityState={{ selected: isLiked(current) }}
                  onPress={() => toggleLike(current)}
                  className="size-11 shrink-0 items-center justify-center rounded-full"
                >
                  <Icon
                    name="heart"
                    className="size-4 text-muted"
                    color={isLiked(current) ? "#ff0000" : undefined}
                    fill={isLiked(current) ? "#ff0000" : "none"}
                  />
                </Pressable>
                {!personal ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Equalizer and space modes"
                    accessibilityState={{ expanded: eqOpen }}
                    onPress={() => setEqOpen((open) => !open)}
                    className={cn(
                      "size-11 shrink-0 flex-row items-center justify-center gap-1 rounded-full",
                      eqChipActive && "bg-accent-soft"
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
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add this song to a playlist"
                  onPress={() => openPicker(current)}
                  className="size-11 shrink-0 items-center justify-center rounded-full text-muted"
                >
                  <Icon name="plus" className="size-4 text-muted" />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Toggle the now playing side panel"
                  accessibilityState={{ selected: nowPlayingOpen }}
                  onPress={() => setNowPlayingOpen(!nowPlayingOpen)}
                  className={cn(
                    "size-11 shrink-0 items-center justify-center rounded-full",
                    nowPlayingOpen ? "bg-accent-soft text-brand" : "text-muted"
                  )}
                >
                  <Icon
                    name="sidebar"
                    className={cn("size-4", nowPlayingOpen ? "text-brand" : "text-muted")}
                  />
                </Pressable>
              </View>
            </View>
            <View className="items-center pt-1">{transport()}</View>
            <PlaybackSeekBar key={current.id} progress={progress} duration={duration} seek={seek} />
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
