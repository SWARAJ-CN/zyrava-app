import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useThemeColor } from "heroui-native";
import { Icon } from "@/components/ui/icons";
import { useMusicPlayer, usePlaybackProgress } from "@/components/providers/MusicPlayerProvider";
import { PlaybackSeekBar } from "./PlaybackSeekBar";

/** Own the clock subscription here, keeping the reader's shell off the 4 Hz path. */
export function NowPlayingTransport({
  bottomInset = 0,
  compact = false,
}: {
  bottomInset?: number;
  compact?: boolean;
}) {
  const { current, queue, index, playing, loading, seek, togglePlay, stepTrack } = useMusicPlayer();
  const { progress, duration } = usePlaybackProgress();
  const spinnerColor = useThemeColor("accent-foreground");
  return (
    <View
      accessibilityLabel="Playback controls"
      style={{
        flexShrink: 0,
        paddingTop: compact ? 0 : 8,
        paddingBottom: Math.max(bottomInset, 12),
      }}
    >
      <PlaybackSeekBar key={current?.id} progress={progress} duration={duration} seek={seek} />
      <View className="flex-row items-center justify-center gap-6">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous track"
          onPress={() => stepTrack(-1)}
          className="size-12 items-center justify-center active:opacity-60"
        >
          <Icon name="skip-back" size={25} className="text-foreground" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? "Pause" : "Play"}
          accessibilityState={{ busy: loading }}
          onPress={togglePlay}
          className="items-center justify-center rounded-full bg-accent active:opacity-80"
          style={{ width: compact ? 48 : 60, height: compact ? 48 : 60 }}
        >
          {loading ? (
            <ActivityIndicator color={spinnerColor} accessibilityLabel="Loading audio" />
          ) : (
            <Icon name={playing ? "pause" : "play"} size={26} className="text-accent-foreground" />
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next track"
          onPress={() => stepTrack(1)}
          className="size-12 items-center justify-center active:opacity-60"
        >
          <Icon name="skip-forward" size={25} className="text-foreground" />
        </Pressable>
      </View>
      {!compact ? (
        <Text className="mt-2 text-center text-[10px] font-medium tracking-wider text-muted">
          {index + 1} / {queue.length} · YOUR QUEUE
        </Text>
      ) : null}
    </View>
  );
}
