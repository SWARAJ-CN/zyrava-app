import { useState } from "react";
import { Text, View } from "react-native";
import { Slider } from "heroui-native";

export function formatPlaybackTime(value: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Preview under the finger; seek the decoder once when the gesture finishes. */
export function PlaybackSeekBar({
  progress,
  duration,
  seek,
}: {
  progress: number;
  duration: number;
  seek: (seconds: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const limit = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const clamp = (value: number | number[]) =>
    Math.max(0, Math.min(limit, (Array.isArray(value) ? value[0] : value) || 0));
  const position = clamp(draft ?? progress);
  return (
    <View className="w-full flex-row items-center gap-2" style={{ minHeight: 40 }}>
      <Text className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
        {formatPlaybackTime(position)}
      </Text>
      <Slider
        aria-label="Seek"
        value={[position]}
        minValue={0}
        maxValue={Math.max(limit, 1)}
        step={1}
        isDisabled={limit <= 0}
        onChange={(value) => setDraft(clamp(value))}
        onChangeEnd={(value) => {
          if (limit > 0) seek(clamp(value));
          setDraft(null);
        }}
        className="min-w-0 flex-1 py-3"
      >
        <Slider.Track className="h-1.5 rounded-full">
          <Slider.Fill className="rounded-full" />
          <Slider.Thumb className="size-4" />
        </Slider.Track>
      </Slider>
      <Text className="w-10 text-[11px] tabular-nums text-muted-foreground">
        {formatPlaybackTime(limit)}
      </Text>
    </View>
  );
}
