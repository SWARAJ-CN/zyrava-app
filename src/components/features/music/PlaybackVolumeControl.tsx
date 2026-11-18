import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Slider } from "heroui-native";
import { Icon } from "@/components/ui/icons";

export function PlaybackVolumeControl({
  volume,
  muted,
  device,
  setVolume,
  setMuted,
}: {
  volume: number;
  muted: boolean;
  device: boolean;
  setVolume: (value: number) => void;
  setMuted: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const percent = draft ?? Math.round(Math.max(0, Math.min(1, volume)) * 100);
  const clamp = (value: number | number[]) =>
    Math.max(0, Math.min(100, (Array.isArray(value) ? value[0] : value) || 0));
  return (
    <View className="w-full flex-row items-center gap-2" style={{ minHeight: 44 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={muted ? "Unmute" : "Mute"}
        onPress={() => setMuted(!muted)}
        className="size-11 items-center justify-center"
      >
        <Icon
          name={muted || volume === 0 ? "volume-x" : "volume-2"}
          className="size-4 text-muted"
        />
      </Pressable>
      <Text className="text-[10px] text-muted">{device ? "Device" : "App"}</Text>
      <Slider
        aria-label={device ? "Device volume" : "App volume"}
        value={[percent]}
        minValue={0}
        maxValue={100}
        step={1}
        onChange={(value) => {
          const next = clamp(value);
          setDraft(next);
          setVolume(next / 100);
        }}
        onChangeEnd={(value) => {
          setVolume(clamp(value) / 100);
          setDraft(null);
        }}
        className="min-w-0 flex-1 py-3"
      >
        <Slider.Track className="h-1.5 rounded-full">
          <Slider.Fill className="rounded-full" />
          <Slider.Thumb className="size-4" />
        </Slider.Track>
      </Slider>
      <Text className="w-10 text-right text-[11px] tabular-nums text-muted">{percent}%</Text>
    </View>
  );
}
