import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";
import { useMusicPlayer } from "@/components/providers/MusicPlayerProvider";
import { NowPlayingTabs, useNowPlayingTab } from "@/components/features/music/NowPlayingTabs";
import { BeatGlow, songHueSeed } from "@/components/features/music/BeatGlow";
import { EqBars } from "@/components/features/music/EqBars";

/**
 * The Spotify-style "Now playing" screen. The web docks a glass card on the
 * right edge; on mobile the same card becomes a full-screen view that
 * AppChrome mounts permanently — it renders nothing until `nowPlayingOpen`
 * flips (the bar's now-playing toggle), and its close button is the exit.
 *
 * The column is scroll-safe (the lyrics/radio panels flex-1 inside), the
 * beat lights sit behind the artwork, and the tab choice keeps its
 * `zyrava:now-playing-tab` persistence.
 */
export function NowPlayingPanel() {
  const {
    queue,
    index,
    current,
    playing,
    queueLabel,
    nowPlayingOpen,
    setNowPlayingOpen,
    togglePlay,
    progress,
    duration,
    getAnalyser,
  } = useMusicPlayer();
  const insets = useSafeAreaInsets();

  /* Read before the early return below: a hook cannot sit behind a guard. */
  const [tab, chooseTab] = useNowPlayingTab();

  if (!nowPlayingOpen || !current) return null;

  return (
    <View className="fixed inset-0 z-40 bg-background">
      {/* Beat-driven RGB lights behind the card's surface. */}
      <BeatGlow getAnalyser={getAnalyser} playing={playing} hueSeed={songHueSeed(current.id)} />

      {/* Header */}
      <View
        className="flex-row items-center justify-between gap-2 px-5 pb-3"
        style={{ paddingTop: insets.top + 16 }}
      >
        <Text numberOfLines={1} className="truncate text-sm font-bold text-foreground">
          {queueLabel || "Now playing"}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setNowPlayingOpen(false)}
          accessibilityLabel="Close now playing panel"
          className="size-8 flex-none items-center justify-center rounded-full text-muted active:bg-surface-secondary active:text-foreground"
        >
          <Icon name="x" className="size-4" />
        </Pressable>
      </View>

      <ScrollView
        className="min-h-0 flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Artwork with the play overlay */}
        <View
          className={cn(
            "group relative w-full overflow-hidden rounded-lg border border-separator bg-surface-muted",
            /* Reading words needs a window, not a strip. In lyrics mode the art
               steps down to a banner and the card hands that height back to the
               lines; the radio tab keeps the square exactly as it was. */
            tab === "lyrics" ? "h-24" : "aspect-square"
          )}
        >
          {current.image ? (
            <Image
              source={{ uri: current.imageLarge || current.image }}
              className="absolute inset-0 size-full"
              resizeMode="cover"
            />
          ) : (
            <View className="h-full items-center justify-center text-faint-foreground">
              <Icon name="music" className="size-10" />
            </View>
          )}
          {playing ? (
            <View className="absolute left-3 top-3">
              <EqBars color="#ffffff" />
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={togglePlay}
            accessibilityLabel={playing ? "Pause" : "Play"}
            className={cn(
              "absolute inset-0 items-center justify-center bg-black/40 transition-opacity duration-200",
              playing ? "opacity-0 active:opacity-100" : "opacity-100"
            )}
          >
            <View className="size-12 items-center justify-center rounded-full bg-white shadow-field">
              <Icon name={playing ? "pause" : "play"} size={22} className="fill-black text-black" />
            </View>
          </Pressable>
        </View>

        {/* Song card — title, artist, album, position */}
        <View className="min-h-0 flex-1 flex-col pb-4 pt-4">
          <Text
            numberOfLines={1}
            className="truncate text-2xl font-black tracking-tight text-foreground"
          >
            {current.title}
          </Text>
          <Text numberOfLines={1} className="mt-1 truncate text-sm font-medium text-muted">
            {current.artist}
          </Text>
          <Text numberOfLines={1} className="mt-0.5 truncate text-xs text-faint-foreground">
            {current.album}
            {current.year ? ` · ${current.year}` : ""}
          </Text>

          <View className="mt-4 flex-row items-center gap-2">
            <View className="rounded-full border border-separator px-2.5 py-1">
              <Text className="text-[11px] font-semibold text-muted">
                {index + 1} of {queue.length}
              </Text>
            </View>
            <Text className="text-[11px] tabular-nums text-faint-foreground">
              {playing ? `${Math.floor(progress)}s elapsed` : "Paused"}
            </Text>
          </View>

          {/* Slim progress read */}
          <View className="mt-2.5">
            <View className="h-1 w-full overflow-hidden rounded-full bg-surface-secondary">
              <View
                className="h-full rounded-full bg-brand"
                style={{ width: `${duration ? Math.min(100, (progress / duration) * 100) : 0}%` }}
              />
            </View>
          </View>

          {/* Lyrics and catalogue radio for whatever is playing, one at a time. */}
          <NowPlayingTabs song={current} tab={tab} onTab={chooseTab} />

          {/* Quick actions pinned at the bottom, Spotify style */}
          <View className="mt-8 flex-row items-center gap-2 border-t border-separator pt-3">
            <Pressable
              accessibilityRole="button"
              onPress={togglePlay}
              accessibilityLabel={playing ? "Pause" : "Play"}
              className="size-10 items-center justify-center rounded-full bg-accent text-accent-foreground transition-transform duration-150 active:scale-95"
            >
              <Icon name={playing ? "pause" : "play"} size={18} className="fill-current" />
            </Pressable>
            <Text
              numberOfLines={1}
              className="ml-auto truncate text-[11px] font-medium text-faint-foreground"
            >
              ZYRAVA
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
