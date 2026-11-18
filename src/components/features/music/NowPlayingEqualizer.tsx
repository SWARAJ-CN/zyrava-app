import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Slider } from "heroui-native";
import {
  EQ_BANDS,
  EQ_PRESETS,
  SPATIAL_MODES,
  useMusicPlayer,
  type EqPreset,
} from "@/components/providers/MusicPlayerProvider";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";

/** Shares the player's actual EQ/Space settings with the dock and mixer. */
export function NowPlayingEqualizer() {
  const {
    eqPreset,
    eqGains,
    applyPreset,
    setEqGains,
    markEqCustom,
    spatialMode,
    setSpatialMode,
    getGraphInfo,
    processingError,
  } = useMusicPlayer();
  const graph = getGraphInfo();
  const supported = graph.equalizer ?? graph.webAudio;
  const spaceSupported = graph.spatial ?? graph.webAudio;
  const [pendingPreset, setPendingPreset] = useState<EqPreset | null>(null);
  const choosePreset = (preset: EqPreset) => {
    if (!supported) return;
    if (preset.heavy && eqPreset !== preset.label) setPendingPreset(preset);
    else applyPreset(preset);
  };

  return (
    <View className="mt-3 min-h-0 flex-1">
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 16 }}
      >
        <View className="flex-row items-center justify-between gap-3">
          <View>
            <Text className="text-base font-semibold text-foreground">Equalizer</Text>
            <Text className="mt-1 text-xs text-muted">10 bands · {eqPreset}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset equalizer to flat"
            disabled={!supported}
            onPress={() => {
              if (supported) applyPreset(EQ_PRESETS[0]);
            }}
            className="min-h-11 items-center justify-center px-3 active:opacity-60 disabled:opacity-40"
          >
            <Text className="text-xs font-semibold text-muted">Reset</Text>
          </Pressable>
        </View>
        {!supported ? (
          <Text className="mt-3 text-xs leading-5 text-muted">
            Starting audio effects. If controls stay unavailable, reload the app or update Android
            System WebView.
          </Text>
        ) : null}
        {supported && !graph.webAudio ? (
          <Text className="mt-3 text-xs leading-5 text-muted">
            EQ and Space · keep the app open. Changes apply to the playing track.
          </Text>
        ) : null}
        {processingError ? (
          <Text accessibilityRole="alert" className="mt-3 text-xs text-danger">
            {processingError}
          </Text>
        ) : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-4"
          contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
          keyboardShouldPersistTaps="handled"
        >
          {EQ_PRESETS.map((preset) => (
            <Pressable
              key={preset.label}
              accessibilityRole="button"
              accessibilityLabel={`${preset.label} equalizer preset`}
              accessibilityState={{ selected: eqPreset === preset.label, disabled: !supported }}
              disabled={!supported}
              onPress={() => choosePreset(preset)}
              className={cn(
                "min-h-10 items-center justify-center rounded-full px-4 active:opacity-70 disabled:opacity-40",
                eqPreset === preset.label ? "bg-accent-soft" : "bg-surface-secondary"
              )}
            >
              <Text
                className={cn(
                  "text-xs font-semibold",
                  eqPreset === preset.label ? "text-accent-soft-foreground" : "text-muted"
                )}
              >
                {preset.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <View className="mt-3">
          {EQ_BANDS.map((band, index) => (
            <EqualizerBand
              key={band.frequency}
              label={band.label}
              frequency={band.frequency}
              value={eqGains[index] ?? 0}
              disabled={!supported}
              onCommit={(value) => {
                if (!supported) return;
                const gains = [...eqGains];
                gains[index] = value;
                setEqGains(gains);
                markEqCustom(gains);
              }}
            />
          ))}
        </View>
        <View className="mt-5">
          <Text className="mb-3 text-sm font-semibold text-foreground">Space</Text>
          {!spaceSupported ? (
            <Text className="mb-3 text-xs text-muted">
              Space is unavailable while the effects player is starting or recovering.
            </Text>
          ) : null}
          <View className="flex-row flex-wrap gap-2">
            {SPATIAL_MODES.map((mode) => (
              <Pressable
                key={mode.value}
                accessibilityRole="button"
                accessibilityLabel={mode.label}
                accessibilityHint={mode.hint}
                accessibilityState={{
                  selected: spatialMode === mode.value,
                  disabled: !spaceSupported,
                }}
                disabled={!spaceSupported}
                onPress={() => {
                  if (spaceSupported) setSpatialMode(mode.value);
                }}
                className={cn(
                  "min-h-10 items-center justify-center rounded-full px-4 active:opacity-70 disabled:opacity-40",
                  spatialMode === mode.value ? "bg-accent-soft" : "bg-surface-secondary"
                )}
              >
                <Text
                  className={cn(
                    "text-xs font-semibold",
                    spatialMode === mode.value ? "text-accent-soft-foreground" : "text-muted"
                  )}
                >
                  {mode.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
      {pendingPreset ? (
        <ConfirmDialog
          open
          title={`${pendingPreset.label} — ear check`}
          description="This preset strongly boosts bass. Start at a low playback volume, especially with headphones or small speakers."
          confirmLabel={`Enable ${pendingPreset.label}`}
          onCancel={() => setPendingPreset(null)}
          onConfirm={() => {
            if (supported) applyPreset(pendingPreset);
            setPendingPreset(null);
          }}
        />
      ) : null}
    </View>
  );
}

/** Keep drag feedback local; publish the complete curve once on release. */
function EqualizerBand({
  label,
  frequency,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  frequency: number;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const displayed = draft ?? value;
  const clamp = (values: number | number[]) => {
    const raw = Array.isArray(values) ? values[0] : values;
    return Math.max(-12, Math.min(12, Math.round((Number.isFinite(raw) ? raw : 0) * 2) / 2));
  };
  return (
    <View className="min-h-12 flex-row items-center gap-3">
      <Text className="w-9 text-xs font-medium text-muted">{label}</Text>
      <Slider
        aria-label={`${frequency} Hz gain`}
        isDisabled={disabled}
        minValue={-12}
        maxValue={12}
        step={0.5}
        value={[displayed]}
        className="min-w-0 flex-1 py-3"
        onChange={(values) => {
          if (!disabled) setDraft(clamp(values));
        }}
        onChangeEnd={(values) => {
          if (!disabled) onCommit(clamp(values));
          setDraft(null);
        }}
      >
        <Slider.Track className="h-1.5 rounded-full">
          <Slider.Fill className="rounded-full" />
          <Slider.Thumb className="size-4" />
        </Slider.Track>
      </Slider>
      <Text className="w-14 text-right text-xs tabular-nums text-muted">
        {displayed > 0 ? "+" : ""}
        {displayed.toFixed(1)} dB
      </Text>
    </View>
  );
}
