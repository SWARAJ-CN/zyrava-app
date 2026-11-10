import { useCallback, useEffect, useRef, useState } from "react";
import { PanResponder, type HostInstance } from "react-native";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import Svg, { Circle, Line, Path, RadialGradient, Stop } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { Slider } from "heroui-native";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Waveform } from "@/components/features/music/Waveform";
import {
  DEFAULT_VOLUME,
  EQ_BANDS,
  EQ_PRESETS,
  FX_LABELS,
  FX_ORDER,
  SPATIAL_MODES,
  useMusicPlayer,
  type EqPreset,
  type FxName,
  type SpatialMode,
} from "@/components/providers/MusicPlayerProvider";
import { PADS, type PadName } from "@/lib/dj/pads";
import type { Song } from "@/lib/saavn";

/** heroui hands Slider changes as `number | number[]` — we always ask one value. */
function sliderValue(value: number | number[]): number {
  return Array.isArray(value) ? value[0] : value;
}

/* ------------------------------------------------------------------ *
 * The hardware console — ported to a state-controlled full-screen overlay:
 * AppChrome keeps it mounted and it renders nothing until `mixerOpen` is on.
 *
 *  • The radial dark backdrop and the play-key gradient run through
 *    expo-linear-gradient (no CSS radial engine on Views); every oklch
 *    literal keeps its exact colour, expressed as the rgb equivalent.
 *  • The knob bay swaps pointer-capture drags for a PanResponder (same 130 px
 *    per full sweep, same clamp/step rounding); double-tap = the web's
 *    double-click reset. Wheel + arrow-key nudging is a pointer/keyboard
 *    affordance — dropped, the touch drag covers it.
 *  • `<select>` becomes an in-place expanding option list with the same
 *    Custom semantics; `Esc` close is replaced by the Close button
 *    (body-scroll-lock is moot — the console owns its own ScrollView).
 *  • Every timer, threshold and mapping (33 ms BPM sampling, 1.45× rolling
 *    mean, 220 ms refractory, median fold 70–180, √rms meter law, .5/.12
 *    ballistics, 0.96 peak decay, 2.5 s clip hold, 1400 ms pad glow) is
 *    verbatim.
 * ------------------------------------------------------------------ */

/** Shared chrome for every console panel. */
const PANEL = "rounded-2xl border border-white/[0.08] bg-white/[0.025]";

/** oklch(0.85 0.16 170) — the console's signal green. */
const SIGNAL = "#2fefbe";
/** oklch(0.78 0.14 170) — the engaged/active tint. */
const ENGAGED = "#3ad4aa";
/** oklch(0.92 0.14 170) — knob pointer. */
const POINTER = "#73ffd6";

/**
 * The hardware console — a full-screen mixer machine: deck with the current
 * song, stereo VU bridge, channel-strip faders for every EQ band, rotary
 * knobs for gain / balance / tempo / master and a backlit FX board for
 * presets and space modes.
 */
export function MixerConsole() {
  const [heavyPending, setHeavyPending] = useState<string | null>(null);
  const {
    queue,
    index,
    current,
    playing,
    progress,
    duration,
    queueLabel,
    volume,
    setVolume,
    preampDb,
    setPreampDb,
    balance,
    setBalance,
    rate,
    setRate,
    eqPreset,
    eqGains,
    setEqGains,
    applyPreset,
    markEqCustom,
    applyCustomPreset,
    spatialMode,
    setSpatialMode,
    muted,
    setMuted,
    loCut,
    setLoCut,
    repeat,
    cycleRepeat,
    shuffle,
    toggleShuffle,
    stop,
    jumpTo,
    crossfade,
    setCrossfade,
    fx,
    setFx,
    sweep,
    setSweep,
    subDb,
    setSubDb,
    compAmt,
    setCompAmt,
    limiterOn,
    setLimiterOn,
    loudnessOn,
    setLoudnessOn,
    playPad,
    togglePlay,
    stepTrack,
    seek,
    getAnalyser,
    getLevels,
    mixerOpen,
    setMixerOpen,
  } = useMusicPlayer();

  /* Lit state for the pad board — each pad glows while it rings. */
  const [padGlow, setPadGlow] = useState<string | null>(null);
  const tapPad = (name: PadName) => {
    playPad(name);
    setPadGlow(name);
    setTimeout(() => setPadGlow((lit) => (lit === name ? null : lit)), 1400);
  };

  /* The web locked body scroll + answered Escape here. Natively the console
   * is its own full-screen layer with its own ScrollView (no page to lock),
   * and the Close button is the exit — hardware-back is the platform's. */

  const choosePreset = (preset: EqPreset) => {
    if (preset.heavy && eqPreset !== preset.label) {
      setHeavyPending(preset.label);
      return;
    }
    applyPreset(preset);
  };

  const resetConsole = () => {
    applyPreset(EQ_PRESETS[0]);
    setPreampDb(0);
    setBalance(0);
    setRate(1);
    setVolume(DEFAULT_VOLUME);
    setLoCut(false);
    setMuted(false);
    setSweep(0);
    setSubDb(0);
    setCompAmt(0);
    setCrossfade(0);
    setLimiterOn(false);
    setLoudnessOn(false);
    setSpatialMode("off");
    setFx({
      echo: 0,
      reverb: 0,
      flanger: 0,
      chorus: 0,
      phaser: 0,
      drive: 0,
      roll: 0,
      stutter: 0,
    });
  };

  /** One master state for the party macro, so its lamp and its switch agree. */
  const partyEngaged =
    subDb >= 4 && loudnessOn && limiterOn && compAmt >= 0.4 && spatialMode === "wide";

  if (!mixerOpen) return null;

  return (
    <View accessibilityViewIsModal className="absolute inset-0 z-50">
      {/* Console head — fixed so the room, the reset and the exit stay put. */}
      <LinearGradient
        colors={["#0d1018", "#05070b", "#020305"]}
        locations={[0, 0.58, 1]}
        className="absolute inset-0"
      />
      <View className="flex-row flex-none items-center gap-x-3 gap-y-2 border-b border-white/[0.06] bg-[#05070b]/85 px-3 py-3">
        <View
          className={cn("size-2 flex-none rounded-full", playing ? "bg-[#5fd37f]" : "bg-white/25")}
        />
        <Text className="text-[10px] font-black uppercase tracking-[0.18em] text-white/80">
          Sound console
        </Text>
        <Text numberOfLines={1} className="min-w-0 flex-1 text-xs font-medium text-white/55">
          {current ? `${current.title} — ${current.artist}` : "No track loaded"}
        </Text>
        <Text className="font-mono text-[10px] tabular-nums tracking-wider text-white/35">
          {queue.length
            ? `${String(index + 1).padStart(2, "0")} / ${String(queue.length).padStart(2, "0")}`
            : "00 / 00"}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={resetConsole}
          accessibilityLabel="Everything back to neutral"
          className="h-9 flex-none rounded-lg border border-white/10 bg-white/[0.04] px-3 items-center justify-center"
        >
          <Text className="text-[10px] font-bold uppercase tracking-wider text-white/55">
            Reset
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setMixerOpen(false)}
          accessibilityLabel="Close the console"
          className="flex h-9 flex-none flex-row items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 active:border-white/20"
        >
          <Icon name="x" className="size-4 text-white/70" />
          <Text className="text-[10px] font-bold uppercase tracking-wider text-white/70">
            Close
          </Text>
        </Pressable>
      </View>

      <ScrollView
        className="min-h-0 flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingTop: 16,
          paddingBottom: 40,
          gap: 16,
        }}
      >
        {/* ── Deck: artwork, VFD readout, transport ── */}
        <View className={cn(PANEL, "p-4")}>
          <View className="flex-row items-start gap-3.5">
            <View className="relative size-24 flex-none overflow-hidden rounded-xl border border-white/10 bg-black/40">
              {current?.image ? (
                <Image
                  source={{ uri: current.imageLarge || current.image }}
                  className={cn("absolute inset-0 size-full", !playing && "opacity-70")}
                  resizeMode="cover"
                />
              ) : (
                <View className="h-full items-center justify-center text-white/30">
                  <Icon name="music" className="size-7 text-white/30" />
                </View>
              )}
            </View>
            <View className="min-w-0 flex-1">
              <Text
                numberOfLines={1}
                className="truncate text-[10px] font-bold uppercase tracking-[0.25em] text-white/40"
              >
                {queueLabel || "Deck A"} · {index + 1}/{queue.length || 0}
              </Text>
              {/* VFD track name */}
              <Text
                numberOfLines={1}
                className={cn(
                  "mt-1 truncate font-mono text-lg font-bold tracking-wide",
                  current ? "text-[#2fefbe]" : "text-white/25"
                )}
              >
                {current?.title ?? "-- no signal --"}
              </Text>
              <Text numberOfLines={1} className="truncate text-xs font-medium text-white/55">
                {current?.artist ?? "--"}
              </Text>

              <View className="mt-2.5 flex-row flex-wrap items-center gap-1.5">
                <View className="rounded border border-white/10 bg-black/25 px-1.5 py-0.5">
                  <Text className="text-[9px] font-semibold uppercase tracking-wider text-white/45">
                    {current ? "320 kbps · AAC" : "no signal"}
                  </Text>
                </View>
                {current?.language ? (
                  <View className="rounded border border-white/10 bg-black/25 px-1.5 py-0.5">
                    <Text className="text-[9px] font-semibold uppercase tracking-wider text-white/45">
                      {current.language}
                    </Text>
                  </View>
                ) : null}
                {current?.year ? (
                  <View className="rounded border border-white/10 bg-black/25 px-1.5 py-0.5">
                    <Text className="text-[9px] font-semibold uppercase tracking-wider text-white/45">
                      {current.year}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Ticker progress — tap anywhere on the bar to seek */}
              <View className="mt-3">
                <View className="flex-row items-center justify-between">
                  <Text className="font-mono text-[10px] tabular-nums text-white/45">
                    {fmt(progress)}
                  </Text>
                  <BpmChip getAnalyser={getAnalyser} active={playing} />
                  <Text className="font-mono text-[10px] tabular-nums text-white/45">
                    -{fmt(Math.max(0, duration - progress))}
                  </Text>
                </View>
                <TickerBar duration={duration} progress={progress} seek={seek} />
              </View>

              {/* Wave monitor — live signal strip off the analyser tap */}
              <View className="mt-3">
                <Text className="pb-1 text-[9px] font-bold uppercase tracking-[0.3em] text-white/35">
                  Wave monitor
                </Text>
                <View className="h-14 overflow-hidden rounded-lg border border-white/10 bg-black/45 px-1.5 py-1">
                  <Waveform
                    getAnalyser={getAnalyser}
                    active={playing}
                    density={5}
                    className="h-full w-full"
                    color={SIGNAL}
                  />
                </View>
              </View>
            </View>
          </View>

          {/* Transport + deck utilities */}
          <View className="mt-4 flex-row flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
            <Pressable
              accessibilityRole="button"
              onPress={() => stepTrack(-1)}
              accessibilityLabel="Previous"
              className="size-10 items-center justify-center rounded-lg bg-white/[0.07] active:bg-white/[0.14]"
            >
              <Icon name="skip-back" className="size-4 fill-current text-white/75" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={togglePlay}
              accessibilityLabel={playing ? "Pause" : "Play"}
              className="size-14 items-center justify-center rounded-xl shadow-[0_16px_44px_rgba(0,0,0,0.45)] transition-transform active:scale-95"
            >
              <LinearGradient
                colors={["#84f8d2", "#13c097"]}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  borderRadius: 12,
                }}
              />
              <Icon name={playing ? "pause" : "play"} size={22} className="fill-black text-black" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => stepTrack(1)}
              accessibilityLabel="Next"
              className="size-10 items-center justify-center rounded-lg bg-white/[0.07] active:bg-white/[0.14]"
            >
              <Icon name="skip-forward" className="size-4 fill-current text-white/75" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={stop}
              accessibilityLabel="Stop — silence and rewind"
              className="size-10 items-center justify-center rounded-lg bg-white/[0.07] active:bg-white/[0.14]"
            >
              <Icon name="square" className="size-3.5 fill-current text-white/75" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={toggleShuffle}
              accessibilityLabel="Shuffle queue"
              accessibilityState={{ selected: shuffle }}
              className={cn(
                "ml-auto size-10 items-center justify-center rounded-lg transition-colors",
                shuffle ? "bg-[#3ad4aa]/15" : "bg-white/[0.07] active:bg-white/[0.14]"
              )}
            >
              <Icon
                name="shuffle"
                className={cn("size-4", shuffle ? "text-[#2fefbe]" : "text-white/75")}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={cycleRepeat}
              accessibilityLabel="Repeat — off, whole queue, this track"
              accessibilityState={{ selected: repeat !== "off" }}
              className={cn(
                "relative size-10 items-center justify-center rounded-lg transition-colors",
                repeat !== "off" ? "bg-[#3ad4aa]/15" : "bg-white/[0.07] active:bg-white/[0.14]"
              )}
            >
              <Icon
                name="repeat"
                className={cn("size-4", repeat !== "off" ? "text-[#2fefbe]" : "text-white/75")}
              />
              {repeat !== "off" ? (
                <Text className="absolute bottom-0.5 left-1/2 -translate-x-1/2 font-mono text-[7px] font-black uppercase tracking-widest text-[#2fefbe]">
                  {repeat === "all" ? "all" : "1"}
                </Text>
              ) : null}
            </Pressable>
          </View>
        </View>

        {/* ── VU bridge segment meters (fixed frame — never resizes) ── */}
        <View className={cn(PANEL, "bg-black/25 p-3")}>
          <Text className="pb-2 text-center text-[9px] font-bold uppercase tracking-[0.3em] text-white/40">
            Output level
          </Text>
          <VUMeter getLevels={getLevels} active={playing} />
        </View>

        {/* ── Knob bay ── */}
        <View className={cn(PANEL, "p-4")}>
          <View className="flex-row flex-wrap justify-between">
            <Knob
              label="Filter"
              value={sweep}
              min={-1}
              max={1}
              step={0.05}
              onChange={setSweep}
              format={(value) =>
                value === 0
                  ? "off"
                  : `${value < 0 ? "HP" : "LP"} ${Math.round(Math.abs(value) * 100)}`
              }
              resetValue={0}
            />
            <Knob
              label="Sub"
              value={subDb}
              min={-12}
              max={12}
              step={0.5}
              onChange={setSubDb}
              format={(value) => `${value > 0 ? "+" : ""}${value.toFixed(1)}`}
              unit="dB"
              resetValue={0}
            />
            <Knob
              label="Gain"
              value={preampDb}
              min={-6}
              max={12}
              step={0.5}
              onChange={setPreampDb}
              format={(value) => `${value > 0 ? "+" : ""}${value.toFixed(1)}`}
              unit="dB"
              resetValue={0}
            />
            <Knob
              label="Balance"
              value={balance}
              min={-1}
              max={1}
              step={0.05}
              onChange={setBalance}
              format={(value) =>
                value === 0 ? "C" : `${value < 0 ? "L" : "R"}${Math.abs(Math.round(value * 100))}`
              }
              resetValue={0}
            />
            <Knob
              label="Tempo"
              value={rate}
              min={0.7}
              max={1.3}
              step={0.05}
              onChange={setRate}
              format={(value) => value.toFixed(2)}
              unit="×"
              resetValue={1}
            />
            <Knob
              label="Master"
              value={volume}
              min={0}
              max={1}
              step={0.01}
              onChange={setVolume}
              format={(value) => `${Math.round(value * 100)}`}
              unit="%"
              resetValue={DEFAULT_VOLUME}
            />
          </View>
          {/* Utility switches: low-cut and mute */}
          <View className="mt-3 flex-row items-center justify-center gap-1.5">
            <SwitchChip
              label="Low cut"
              hint="40 Hz rumble filter — cleans big PA stacks and bus subs"
              engaged={loCut}
              onClick={() => setLoCut(!loCut)}
            />
            <SwitchChip
              label="Mute"
              hint="Silence the master output"
              engaged={muted}
              onClick={() => setMuted(!muted)}
            />
          </View>
        </View>

        {/* ── DJ effect rack: dry/wet send per slot, like a real FX unit ── */}
        <View className={cn(PANEL, "p-4")}>
          <View className="pb-3">
            <Text className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/40">
              Effect rack · wet send
            </Text>
            <Text className="pt-0.5 text-[10px] font-medium text-white/30">
              0 = pure signal · 100 = full effect
            </Text>
          </View>
          <View className="flex-col gap-2">
            {FX_ORDER.map((name) => (
              <FxRow
                key={name}
                name={name}
                value={fx[name]}
                onChange={(value) => setFx({ [name]: value })}
              />
            ))}
          </View>
        </View>

        {/* ── Dynamics + Auto DJ + party pads ── */}
        <View className={cn(PANEL, "p-4")}>
          <Text className="pb-3 text-[10px] font-bold uppercase tracking-[0.3em] text-white/40">
            Bus · Auto DJ · Pads
          </Text>

          <View className="flex-col gap-6">
            {/* Dynamics rows */}
            <View className="flex-col gap-2.5">
              <HorizontalFader
                label="Compressor"
                value={compAmt}
                onChange={setCompAmt}
                format={(value) => `${Math.round(value * 100)}%`}
                hint="Smooths big level swings — radio-style glue"
              />
              <View className="flex-row items-center justify-between">
                <Text className="text-[11px] font-bold text-white/55">Limiter</Text>
                <SwitchChip
                  label={limiterOn ? "armed" : "off"}
                  hint="Brick-wall safety for the master bus"
                  engaged={limiterOn}
                  onClick={() => setLimiterOn(!limiterOn)}
                />
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="text-[11px] font-bold text-white/55">Loudness</Text>
                <SwitchChip
                  label={loudnessOn ? "on" : "off"}
                  hint="Warm low + airy top shelf — friendly loud"
                  engaged={loudnessOn}
                  onClick={() => setLoudnessOn(!loudnessOn)}
                />
              </View>
            </View>

            {/* Auto DJ rows */}
            <View className="flex-col gap-2.5">
              <HorizontalFader
                label="Crossfade"
                value={crossfade}
                max={8}
                onChange={setCrossfade}
                format={(value) => (value === 0 ? "hard cut" : `${value.toFixed(1)} s`)}
                hint="Track hand-off fade — the DJ blend"
              />
              <View className="flex-row items-center justify-between">
                <Text className="text-[11px] font-bold text-white/55">Auto mix</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Shuffle + 4-second crossfade hand-offs"
                  accessibilityState={{ selected: shuffle && crossfade >= 4 }}
                  onPress={() => {
                    const engaged = shuffle && crossfade >= 4;
                    if (engaged) {
                      if (shuffle) toggleShuffle();
                      setCrossfade(0);
                    } else {
                      if (!shuffle) toggleShuffle();
                      setCrossfade(4);
                    }
                  }}
                  className={cn(
                    "flex-row items-center gap-1.5 rounded border px-2.5 py-1",
                    shuffle && crossfade >= 4
                      ? "border-[#3ad4aa]/60 bg-[#3ad4aa]/[0.12]"
                      : "border-white/10 bg-black/25 active:border-white/25"
                  )}
                >
                  <View
                    className={cn(
                      "size-1.5 rounded-full",
                      shuffle && crossfade >= 4 ? "bg-[#2fefbe]" : "bg-white/20"
                    )}
                  />
                  <Text
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-wider",
                      shuffle && crossfade >= 4 ? "text-[#2fefbe]" : "text-white/50"
                    )}
                  >
                    flow
                  </Text>
                </Pressable>
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="text-[11px] font-bold text-white/55">Party mode</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Sub lift, loudness, glue and a wide stage"
                  accessibilityState={{ selected: partyEngaged }}
                  onPress={() => {
                    if (partyEngaged) {
                      setSubDb(0);
                      setLoudnessOn(false);
                      setCompAmt(0);
                      setLimiterOn(false);
                      setSpatialMode("off");
                    } else {
                      setSubDb(5);
                      setLoudnessOn(true);
                      setCompAmt(0.5);
                      setLimiterOn(true);
                      setSpatialMode("wide");
                    }
                  }}
                  className={cn(
                    "flex-row items-center gap-1.5 rounded border px-2.5 py-1",
                    partyEngaged
                      ? "border-[#ffbc49]/60 bg-[#ffbc49]/[0.12]"
                      : "border-white/10 bg-black/25 active:border-white/25"
                  )}
                >
                  <View
                    className={cn(
                      "size-1.5 rounded-full",
                      partyEngaged ? "bg-[#ffbc49]" : "bg-white/20"
                    )}
                  />
                  <Text
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-wider",
                      partyEngaged ? "text-[#ffbc49]" : "text-white/50"
                    )}
                  >
                    ignite
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Pad board */}
            <View>
              <Text className="pb-1.5 text-[10px] font-bold uppercase tracking-widest text-white/35">
                Pads · one-tap FX
              </Text>
              <View className="flex-row flex-wrap gap-1.5">
                {PADS.map((pad) => (
                  <Pressable
                    key={pad.name}
                    accessibilityRole="button"
                    accessibilityLabel={pad.hint}
                    onPress={() => tapPad(pad.name)}
                    className={cn(
                      "min-w-[23%] flex-1 flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 transition-all duration-150 active:scale-95",
                      padGlow === pad.name
                        ? "border-[#2fefbe] bg-[#3ad4aa]/[0.2]"
                        : "border-white/10 bg-black/25 active:border-white/25"
                    )}
                  >
                    <Icon
                      name={
                        pad.name === "siren"
                          ? "bell"
                          : pad.name === "laser"
                            ? "zap"
                            : pad.name === "crowd"
                              ? "globe"
                              : pad.name === "riser"
                                ? "waves"
                                : pad.name === "air-horn"
                                  ? "volume-2"
                                  : pad.name === "bass-drop"
                                    ? "volume-1"
                                    : "activity"
                      }
                      className={cn(
                        "size-4",
                        padGlow === pad.name ? "text-[#3bf5c4]" : "text-white/55"
                      )}
                    />
                    <Text
                      className={cn(
                        "text-[9px] font-bold uppercase tracking-wide",
                        padGlow === pad.name ? "text-[#3bf5c4]" : "text-white/55"
                      )}
                    >
                      {pad.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* ── Queue control strip ── */}
        {queue.length > 0 ? (
          <View className={cn(PANEL, "p-3")}>
            <Text className="pb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-white/40">
              Queue control · {queue.length} tracks {shuffle ? "· shuffled" : ""}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6, paddingBottom: 4 }}
            >
              {queue.map((song: Song, position: number) => (
                <Pressable
                  key={`${song.id}-${position}`}
                  accessibilityRole="button"
                  onPress={() => jumpTo(position)}
                  className={cn(
                    "flex-none max-w-44 rounded border px-2.5 py-1.5",
                    position === index
                      ? "border-[#3ad4aa]/60 bg-[#3ad4aa]/[0.12]"
                      : "border-white/10 bg-black/25 active:border-white/25"
                  )}
                >
                  <Text
                    numberOfLines={1}
                    className={cn(
                      "text-[11px] font-semibold",
                      position === index ? "text-[#2fefbe]" : "text-white/55"
                    )}
                  >
                    {`${String(position + 1).padStart(2, "0")} ${song.title}`}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* ── Channel strips: ten EQ faders + the FX board below ── */}
        <View className={cn(PANEL, "p-4")}>
          <View className="flex-row flex-wrap items-center justify-between gap-3 pb-4">
            <View>
              <Text className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/40">
                Channel EQ · 10-band
              </Text>
              <Text className="pt-1 text-[11px] font-medium text-white/30">
                ±12 dB per band · move a band to save it as Custom
              </Text>
            </View>
            <EqPresetMenu
              value={eqPreset}
              onPick={(label) => {
                if (label === "Custom") {
                  applyCustomPreset();
                  return;
                }
                const preset = EQ_PRESETS.find((entry) => entry.label === label);
                if (preset) choosePreset(preset);
              }}
            />
          </View>

          {/* Fader strips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ alignItems: "flex-end", gap: 4, paddingBottom: 4 }}
          >
            {EQ_BANDS.map((band, bandIndex) => (
              <FaderStrip
                key={band.frequency}
                label={band.label}
                value={eqGains[bandIndex] ?? 0}
                onChange={(value) => {
                  const gains = [...eqGains];
                  gains[bandIndex] = value;
                  setEqGains(gains);
                  markEqCustom(gains);
                }}
              />
            ))}
          </ScrollView>
        </View>

        {/* ── FX board: space modes as backlit switches ── */}
        <View className={cn(PANEL, "p-4")}>
          <Text className="pb-2.5 text-[10px] font-bold uppercase tracking-[0.3em] text-white/40">
            Space processor
          </Text>
          <View className="flex-row flex-wrap gap-1.5">
            {SPATIAL_MODES.map((mode) => {
              const engaged = spatialMode === mode.value;
              return (
                <Pressable
                  key={mode.value}
                  accessibilityRole="button"
                  accessibilityLabel={mode.hint}
                  accessibilityState={{ selected: engaged }}
                  onPress={() => setSpatialMode(mode.value as SpatialMode)}
                  className={cn(
                    "min-h-14 w-[31%] flex-grow basis-[31%] flex-col items-center justify-center gap-1.5 rounded-lg border px-1 py-2 transition-all duration-150",
                    engaged
                      ? "border-[#3ad4aa]/60 bg-[#3ad4aa]/[0.12]"
                      : "border-white/10 bg-black/25 active:border-white/25"
                  )}
                >
                  <View
                    className={cn("h-2 w-2 rounded-full", engaged ? "bg-[#2fefbe]" : "bg-white/20")}
                  />
                  <Text
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-wider",
                      engaged ? "text-[#2fefbe]" : "text-white/50"
                    )}
                  >
                    {mode.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* Heavy preset hearing-safety dialog — console copy, verbatim. */}
      <ConfirmDialog
        open={heavyPending !== null}
        title={`${heavyPending ?? ""} — ear check`}
        description={
          "Heavy-duty profiles drive big stacks hard. Loud as it needs to be — no louder."
        }
        confirmLabel="Enable"
        destructive
        onCancel={() => setHeavyPending(null)}
        onConfirm={() => {
          applyPreset(EQ_PRESETS.find((preset) => preset.label === heavyPending) ?? EQ_PRESETS[0]);
          setHeavyPending(null);
        }}
      />
    </View>
  );
}

/** Tappable click-seek ticker — the web measured the box; RN gives us the
 *  press offset straight off the event, divided by the rail's own width. */
function TickerBar({
  duration,
  progress,
  seek,
}: {
  duration: number;
  progress: number;
  seek: (seconds: number) => void;
}) {
  const widthRef = useRef(0);
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Seek"
      onPress={(event) => {
        const width = widthRef.current;
        const x = event.nativeEvent.locationX;
        if (duration && width > 0 && typeof x === "number") {
          const fraction = x / width;
          if (fraction >= 0 && fraction <= 1) seek(fraction * duration);
        }
      }}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onLayout={(event) => {
        widthRef.current = event.nativeEvent.layout.width;
      }}
      className="mt-1 w-full"
    >
      {/* The rail grows under the finger — the web's group-hover:h-2.5. */}
      <View
        className="overflow-hidden rounded-full bg-black/40"
        style={{ height: pressed ? 10 : 6 }}
      >
        <View
          className="h-full rounded-full"
          style={{
            width: `${duration ? (progress / duration) * 100 : 0}%`,
            backgroundColor: SIGNAL,
          }}
        />
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ *
 * SwitchChip — one backlit utility switch.     *
 * ------------------------------------------------------------------ */
function SwitchChip({
  label,
  hint,
  engaged,
  onClick,
}: {
  label: string;
  hint: string;
  engaged: boolean;
  onClick: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint}
      accessibilityState={{ selected: engaged }}
      onPress={onClick}
      className={cn(
        "flex-row items-center gap-1.5 rounded border px-2.5 py-1.5",
        engaged
          ? "border-[#3ad4aa]/60 bg-[#3ad4aa]/[0.12]"
          : "border-white/10 bg-black/25 active:border-white/25"
      )}
    >
      <View className={cn("size-1.5 rounded-full", engaged ? "bg-[#2fefbe]" : "bg-white/20")} />
      <Text
        className={cn(
          "text-[10px] font-bold uppercase tracking-wider",
          engaged ? "text-[#2fefbe]" : "text-white/50"
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ *
 * FxRow — one wet-send row in the FX rack.     *
 * ------------------------------------------------------------------ */
function FxRow({
  name,
  value,
  onChange,
}: {
  name: FxName;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <View
        className={cn(
          "size-1.5 flex-none rounded-full",
          value > 0 ? "bg-[#2fefbe]" : "bg-white/20"
        )}
      />
      <Text className="w-20 flex-none text-[11px] font-bold text-white/60">{FX_LABELS[name]}</Text>
      <Slider
        value={[Math.round(value * 100)]}
        minValue={0}
        maxValue={100}
        step={1}
        aria-label={`${FX_LABELS[name]} wet level`}
        onChange={(values) => onChange(sliderValue(values) / 100)}
        className="min-w-0 flex-1"
      >
        <Slider.Track className="h-1 rounded-full bg-white/10">
          <Slider.Fill className="rounded-full" />
          <Slider.Thumb className="size-3" />
        </Slider.Track>
      </Slider>
      <Text
        className={cn(
          "w-9 flex-none text-right font-mono text-[10px] font-bold tabular-nums",
          value > 0 ? "text-[#2fefbe]" : "text-white/40"
        )}
      >
        {Math.round(value * 100)}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * HorizontalFader — labeled 0..max slider row for dynamics / timing.   *
 * ------------------------------------------------------------------ */
function HorizontalFader({
  label,
  value,
  max = 1,
  onChange,
  format,
  hint,
}: {
  label: string;
  value: number;
  max?: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
  hint: string;
}) {
  return (
    <View>
      <View className="flex-row items-center justify-between gap-2">
        <Text numberOfLines={1} className="truncate text-[11px] font-bold text-white/55">
          {label}
        </Text>
        <Text className="flex-none font-mono text-[10px] font-bold tabular-nums text-[#2fefbe]">
          {format(value)}
        </Text>
      </View>
      <Slider
        value={[value]}
        minValue={0}
        maxValue={max}
        step={max <= 1 ? 0.05 : 0.5}
        aria-label={label}
        accessibilityHint={hint}
        onChange={(values) => onChange(sliderValue(values))}
        className="mt-1"
      >
        <Slider.Track className="h-1 rounded-full bg-white/10">
          <Slider.Fill className="rounded-full" />
          <Slider.Thumb className="size-3" />
        </Slider.Track>
      </Slider>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * BpmChip — live BPM estimate from bass-energy impulse intervals.      *
 * ------------------------------------------------------------------ */
function BpmChip({
  getAnalyser,
  active,
}: {
  getAnalyser: () => import("react-native-audio-api").AnalyserNode | null;
  active: boolean;
}) {
  const [bpm, setBpm] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      // Reset on the animation clock — React 19's setState-in-effect rule.
      const settle = requestAnimationFrame(() => setBpm(null));
      return () => cancelAnimationFrame(settle);
    }
    const beats: number[] = [];
    const energies: number[] = [];
    let last: number | null = null;
    const finalize = setInterval(() => {
      if (beats.length >= 4) {
        // Median interval between impulses → BPM, folded into 70–180.
        const gaps = beats
          .slice(1)
          .map((time, i) => time - beats[i])
          .sort((a, b) => a - b);
        const median = gaps[gaps.length >> 1];
        let value = 60000 / median;
        while (value < 70) value *= 2;
        while (value > 180) value /= 2;
        setBpm(Math.round(value));
      } else {
        setBpm(null);
      }
    }, 1100);

    const timer = setInterval(() => {
      const analyser = getAnalyser();
      if (!analyser) return;
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      let bass = 0;
      for (let bin = 0; bin < 8 && bin < data.length; bin += 1) bass += data[bin];
      bass /= Math.min(8, data.length);
      energies.push(bass);
      if (energies.length > 30) energies.shift();
      const baseline =
        energies.reduce((sum, value) => sum + value, 0) / Math.max(1, energies.length);
      const now = performance.now();
      if (bass > baseline * 1.45 && bass > 60) {
        if (last === null || now - last > 220) {
          beats.push(now);
          last = now;
        }
      }
      if (beats.length > 20) beats.shift();
    }, 33);
    return () => {
      clearInterval(timer);
      clearInterval(finalize);
    };
  }, [active, getAnalyser]);

  return (
    <Text className="min-w-10 text-center font-mono text-[10px] font-bold tabular-nums text-white/55">
      {bpm ? <Text className="text-[#2fefbe]">{bpm} BPM</Text> : "-- BPM"}
    </Text>
  );
}

/* ------------------------------------------------------------------ *
 * VU bridge — stereo LED segments fed live from the meter taps.*
 * ------------------------------------------------------------------ */
function VUMeter({ getLevels, active }: { getLevels: () => [number, number]; active: boolean }) {
  const [meter, setMeter] = useState<{
    levels: [number, number];
    peaks: [number, number];
    db: [number, number];
  }>({
    levels: [0, 0],
    peaks: [0, 0],
    db: [-Infinity, -Infinity],
  });
  const [clip, setClip] = useState(false);
  const clipHoldRef = useRef(0);

  useEffect(() => {
    if (!active) {
      // Meter decay — zero out on the animation clock instead of in the
      // effect body (React 19's setState-in-effect rule).
      const settle = requestAnimationFrame(() => {
        clipHoldRef.current = 0;
        setClip(false);
        setMeter({ levels: [0, 0], peaks: [0, 0], db: [-Infinity, -Infinity] });
      });
      return () => cancelAnimationFrame(settle);
    }
    let frame = requestAnimationFrame(loop);
    const peaksRef: [number, number] = [0, 0];
    // Ballistics: rise fast, fall slow — the meter glides like needle gear
    // instead of twitching at raw frame-rate RMS.
    const smoothRef: [number, number] = [0, 0];
    function loop() {
      const [l, r] = getLevels();
      // Clip catch: hold the red lamp 2.5s after the last overload.
      const peakRms = Math.max(l, r);
      clipHoldRef.current = Math.min(clipHoldRef.current + (peakRms > 0.92 ? 1 : -0.016), 1);
      setClip(clipHoldRef.current > 0.2);
      // dB-ish scale: half-RootSquare mapping; 0.28 RMS ~ near full swing.
      const toMeter = (rms: number) => Math.min(1, Math.max(0, (Math.sqrt(rms) - 0.05) / 0.45));
      const raw: [number, number] = [toMeter(l), toMeter(r)];
      smoothRef[0] += (raw[0] - smoothRef[0]) * (smoothRef[0] < raw[0] ? 0.5 : 0.12);
      smoothRef[1] += (raw[1] - smoothRef[1]) * (smoothRef[1] < raw[1] ? 0.5 : 0.12);
      peaksRef[0] = Math.max(peaksRef[0] * 0.96, smoothRef[0]);
      peaksRef[1] = Math.max(peaksRef[1] * 0.96, smoothRef[1]);
      setMeter({
        levels: [smoothRef[0], smoothRef[1]],
        peaks: [peaksRef[0], peaksRef[1]],
        db: [l > 1e-4 ? 20 * Math.log10(l) : -Infinity, r > 1e-4 ? 20 * Math.log10(r) : -Infinity],
      });
      frame = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(frame);
  }, [active, getLevels]);

  return (
    <View className="flex-col items-center gap-1.5">
      {/* Clip lamp — lights red and holds for a beat after an overload */}
      <View className={cn("rounded px-1.5 py-0.5", clip ? "bg-[#f4514f]" : "bg-white/10")}>
        <Text
          className={cn(
            "font-mono text-[8px] font-black uppercase tracking-widest",
            clip ? "text-white" : "text-white/30"
          )}
        >
          clip
        </Text>
      </View>
      <View className="flex-row items-center justify-center gap-2.5">
        {(["L", "R"] as const).map((side, channel) => (
          <View key={side} className="flex-col items-center gap-1">
            {/* Per-channel dB readout, straight off the meter tap (fixed box) */}
            <Text className="min-w-[4.25rem] text-center font-mono text-[10px] font-bold tabular-nums text-[#2fefbe]">
              {meter.db[channel] === -Infinity
                ? "−∞.−"
                : meter.db[channel].toFixed(1).padStart(4, " ")}
              <Text className="text-white/30"> dB</Text>
            </Text>
            <View
              className="relative w-5 flex-col-reverse gap-[2px] rounded bg-black/50 p-1"
              style={{ height: 14 * 8 }}
            >
              {Array.from({ length: 14 }).map((_, segment) => {
                const lit = meter.levels[channel] * 14 > segment;
                const green = segment < 8;
                const amber = segment >= 8 && segment < 12;
                return (
                  <View
                    key={segment}
                    className={cn(
                      "h-1.5 w-full rounded-[1px]",
                      lit
                        ? green
                          ? "bg-[#3ce074]"
                          : amber
                            ? "bg-[#f3ba25]"
                            : "bg-[#f4514f]"
                        : "bg-white/[0.07]"
                    )}
                  />
                );
              })}
              {/* peak-hold tick */}
              <View
                pointerEvents="none"
                className="absolute inset-x-1 h-[2px] bg-white/80"
                style={{ bottom: `${meter.peaks[channel] * 100}%` }}
              />
            </View>
            <Text className="font-mono text-[9px] font-bold text-white/45">{side}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Knob — touch-draggable rotary with an accent value arc.
 *
 * Pointer-capture vertical drag (RN PanResponder): the same 130 px-per-full-
 * sweep sensitivity, same clamp/step rounding, double-tap = reset (the web's
 * double-click). Wheel + arrow-key handling is pointer/keyboard-only —
 * dropped.
 *
 * PanResponder predates React Compiler: its handlers execute in the touch
 * phase, so the ref/purity rules cannot read this pattern correctly. */
/* eslint-disable react-hooks/refs, react-hooks/purity */
const SWEEP_START = -135;
const SWEEP = 270;

function Knob({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  unit,
  resetValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
  unit?: string;
  /** Where a double-tap lands — defaults to the centre of the sweep. */
  resetValue?: number;
}) {
  const fraction = (value - min) / (max - min);
  const angle = SWEEP_START + fraction * SWEEP;
  const dragRef = useRef<{ y: number; value: number }>({ y: 0, value: 0 });
  const lastTapRef = useRef(0);
  /** The web's live handlers must never read a stale closure — refs it is. */
  const latest = useRef({ value, min, max, step, onChange, resetValue });
  useEffect(() => {
    latest.current = { value, min, max, step, onChange, resetValue };
  }, [value, min, max, step, onChange, resetValue]);

  const clamp = useCallback((next: number) => {
    const { min: lo, max: hi, step: st } = latest.current;
    const rounded = Math.round(next / st) * st;
    return Math.min(hi, Math.max(lo, Number(rounded.toFixed(4))));
  }, []);

  /* Created once lazily — the web attached its window listeners at mount. */
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (_event, gestureState) => {
        dragRef.current = { y: gestureState.y0, value: latest.current.value };
      },
      onPanResponderMove: (_event, gestureState) => {
        const { min: lo, max: hi, onChange: emit } = latest.current;
        const delta = (dragRef.current.y - gestureState.moveY) / 130;
        emit(clamp(dragRef.current.value + delta * (hi - lo)));
      },
      onPanResponderRelease: () => {
        // Double-tap reset (the web's onDoubleClick).
        const now = Date.now();
        if (now - lastTapRef.current < 300) {
          const { resetValue: reset, min: lo, max: hi, onChange: emit } = latest.current;
          emit(clamp(reset ?? (lo + hi) / 2));
        }
        lastTapRef.current = now;
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  // Arc geometry: radius 30 on a 74 box, gap at the bottom (270 sweep).
  const knobSize = 74;
  const radius = 30;
  const center = knobSize / 2;
  const polar = (deg: number, r: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [center + r * Math.cos(rad), center + r * Math.sin(rad)];
  };
  const arc = (fromDeg: number, toDeg: number, r: number) => {
    const [x1, y1] = polar(fromDeg, r);
    const [x2, y2] = polar(toDeg, r);
    const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const [tipX, tipY] = polar(angle, radius - 5);

  return (
    <View className="flex-col items-center gap-1 py-1.5" style={{ width: "31%" }}>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: Number(value.toFixed(4)) }}
        className="rounded-full"
        {...panResponder.panHandlers}
        style={{ width: knobSize, height: knobSize }}
      >
        <Svg width={knobSize} height={knobSize} viewBox={`0 0 ${knobSize} ${knobSize}`}>
          {/* The knob's radial core gradient (same stops as the web defs). */}
          <RadialGradient id={`core-${label}`} cx="50%" cy="35%" r="80%">
            <Stop offset="0%" stopColor="#232c36" />
            <Stop offset="100%" stopColor="#10151c" />
          </RadialGradient>
          {/* Case */}
          <Circle cx={center} cy={center} r={radius + 5} fill="#0a0e13" />
          <Circle
            cx={center}
            cy={center}
            r={radius + 4}
            fill={`url(#core-${label})`}
            stroke="#000"
            strokeOpacity={0.6}
          />
          {/* Track arc */}
          <Path
            d={arc(SWEEP_START, SWEEP_START + SWEEP, radius)}
            fill="none"
            stroke="rgba(255,255,255,0.14)"
            strokeWidth={3}
            strokeLinecap="round"
          />
          {/* Value arc */}
          {fraction > 0.001 ? (
            <Path
              d={arc(SWEEP_START, angle, radius)}
              fill="none"
              stroke={ENGAGED}
              strokeWidth={3}
              strokeLinecap="round"
            />
          ) : null}
          {/* Pointer */}
          <Line
            x1={center}
            y1={center}
            x2={tipX}
            y2={tipY}
            stroke={POINTER}
            strokeWidth={2.4}
            strokeLinecap="round"
          />
          <Circle cx={center} cy={center} r={3} fill="rgba(255,255,255,0.35)" />
        </Svg>
      </View>
      <Text className="font-mono text-[11px] font-bold tabular-nums text-[#2fefbe]">
        {format(value)}
        {unit ? <Text className="text-white/40">{unit}</Text> : null}
      </Text>
      <Text className="text-[10px] font-bold uppercase tracking-wider text-white/45">{label}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Fader strip — one vertical fader per EQ band, dB under it.
 *
 * Pointer capture → PanResponder; the window pointermove/pointerup pair is
 * the responder's own move/release; the double-click reset becomes a
 * double-tap; arrow-key nudging (pointer/keyboard-only) is dropped. The
 * geometry — 152 px rail, 8 px pads, 24 px handle, 9 ticks, ±12 dB in half
 * steps — is the web's, to the pixel.
 * ------------------------------------------------------------------ */
function FaderStrip({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const trackRef = useRef<HostInstance | null>(null);
  const height = 152;
  const pad = 8;
  const handle = 24;
  const travel = height - pad * 2 - handle;
  const min = -12;
  const max = 12;
  const fraction = (value - min) / (max - min);
  const dragRef = useRef(false);
  const lastTapRef = useRef(0);
  const boxRef = useRef({ top: 0 });
  /** Latest onChange — the responder lives for the whole mount, so it must
   *  never read a stale closure from the first render. */
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const apply = (pageY: number) => {
    // Match the handle geometry: the pointer aims at the handle's centre,
    // which travels between the rail top (+12 dB) and floor (−12 dB).
    const raw = 1 - (pageY - boxRef.current.top - pad - handle / 2) / travel;
    const fraction = Math.min(1, Math.max(0, raw));
    const rounded = Math.round((min + fraction * (max - min)) * 2) / 2;
    onChangeRef.current(Number(rounded.toFixed(2)));
  };

  /* Created once lazily — the web attached its window listeners at mount. */
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (_event, gestureState) => {
        dragRef.current = true;
        // The rail may have scrolled under the finger since the last layout —
        // re-measure at the start of every drag (getBoundingClientRect twin).
        trackRef.current?.measureInWindow((_x, y) => {
          boxRef.current.top = y;
          apply(gestureState.y0);
        });
        // Double-tap resets the band to 0 (the web's onDoubleClick).
        const now = Date.now();
        if (now - lastTapRef.current < 300) {
          dragRef.current = false;
          onChangeRef.current(0);
        }
        lastTapRef.current = now;
      },
      onPanResponderMove: (_event, gestureState) => {
        if (!dragRef.current) return;
        apply(gestureState.moveY);
      },
      onPanResponderRelease: () => {
        dragRef.current = false;
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  return (
    <View className="flex-none flex-col items-center gap-1.5">
      <Text
        className={cn(
          "font-mono text-[9px] font-bold tabular-nums",
          value > 0 ? "text-[#2fefbe]" : value < 0 ? "text-white/40" : "text-white/60"
        )}
      >
        {value > 0 ? "+" : ""}
        {value.toFixed(1)}
      </Text>
      <View
        ref={trackRef}
        accessibilityRole="adjustable"
        accessibilityLabel={`${label} Hz band`}
        accessibilityValue={{ min, max, now: value }}
        className="relative w-8 rounded-md bg-black/45"
        style={{ height }}
        {...panResponder.panHandlers}
      >
        {/* Graduated rail — geometry: 8px pads, 24px handle, value ↑ = dB ↑. */}
        <View className="absolute inset-x-1/2 top-2 bottom-2 w-1 -translate-x-1/2 rounded-full bg-white/10" />
        {Array.from({ length: 9 }).map((_, tick) => (
          <View
            key={tick}
            className="absolute left-1/2 h-px w-2.5 -translate-x-1/2 bg-white/15"
            style={{ top: 8 + (tick * (height - 16)) / 8 }}
          />
        ))}
        {/* Lit fill from the handle down to the rail floor — grows with the gain. */}
        <View
          className="absolute inset-x-1/2 w-1 -translate-x-1/2 rounded-full"
          style={{
            backgroundColor: "#1ed5a9",
            top: height - 8 - Math.max(1, fraction * travel),
            height: Math.max(1, fraction * travel),
          }}
        />
        {/* Handle */}
        <View
          className="absolute left-1/2 size-6 -translate-x-1/2 rounded-md border border-white/20"
          style={{
            top: 8 + (1 - fraction) * travel,
            backgroundColor: "#1b222c",
            shadowColor: "#000",
            shadowOpacity: 0.55,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 3 },
          }}
        >
          <View className="absolute left-1/2 top-1.5 h-px w-3.5 -translate-x-1/2 bg-white/50" />
          <View className="absolute left-1/2 top-1/2 h-px w-3.5 -translate-x-1/2 bg-white/40" />
          <View className="absolute left-1/2 bottom-1.5 h-px w-3.5 -translate-x-1/2 bg-white/50" />
        </View>
      </View>
      <Text className="text-[9px] font-bold uppercase text-white/45">{label}</Text>
    </View>
  );
}

/** The channel-EQ preset list — `<select>` has no native twin, so the button
 *  expands the options in place (Custom behaves exactly like the web). */
function EqPresetMenu({ value, onPick }: { value: string; onPick: (label: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <View className="min-w-[10rem] flex-1">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Equalizer preset"
        onPress={() => setOpen((v) => !v)}
        className="flex h-9 flex-row items-center justify-between rounded-lg border border-white/10 bg-black/35 px-2.5 active:border-white/25"
      >
        <Text className="text-[10px] font-bold uppercase tracking-wider text-white/35">Preset</Text>
        <Text className="font-semibold text-white/80" numberOfLines={1}>
          {value}
        </Text>
      </Pressable>
      {open ? (
        <ScrollView
          nestedScrollEnabled
          className="max-h-56 rounded-lg border border-white/10 bg-[#0a0f14]"
        >
          {["Custom", ...EQ_PRESETS.map((preset) => preset.label)].map((option) => (
            <Pressable
              key={option}
              accessibilityRole="button"
              onPress={() => {
                onPick(option);
                setOpen(false);
              }}
              className={cn(
                "flex-row items-center justify-between border-b border-white/5 px-2.5 py-2 last:border-b-0",
                value === option ? "bg-white/[0.06]" : "active:bg-white/[0.04]"
              )}
            >
              <Text className="text-white/80">{option}</Text>
              {value === option ? <Icon name="check" className="size-3.5 text-[#2fefbe]" /> : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function fmt(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}
/* eslint-enable react-hooks/refs, react-hooks/purity */
