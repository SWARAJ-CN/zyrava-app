import { useState } from "react";
import { FullscreenLyrics } from "./FullscreenLyrics";
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePanelBackHandler } from "@/hooks/usePanelBackHandler";
import { Icon } from "@/components/ui/icons";
import { useMusicPlayer } from "@/components/providers/MusicPlayerProvider";
import { NowPlayingTabs, useNowPlayingTab } from "./NowPlayingTabs";
import { songHueSeed } from "./BeatGlow";
import { NowPlayingBackdrop } from "./NowPlayingBackdrop";
import { NowPlayingTransport } from "./NowPlayingTransport";

/** A bounded reader: only lyrics/radio scroll; transport never leaves the screen. */
export function NowPlayingPanel() {
  const { current, playing, queueLabel, nowPlayingOpen, setNowPlayingOpen, getAnalyser } =
    useMusicPlayer();
  const [fullscreen, setFullscreen] = useState(false);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const compact = height < 600;
  const [tab, chooseTab] = useNowPlayingTab();
  usePanelBackHandler(nowPlayingOpen, () => setNowPlayingOpen(false));
  if (!nowPlayingOpen || !current) return null;

  if (fullscreen) return <FullscreenLyrics onClose={() => setFullscreen(false)} />;

  return (
    <View
      accessibilityViewIsModal
      style={[StyleSheet.absoluteFill, { zIndex: 50 }]}
      className="bg-background"
    >
      <NowPlayingBackdrop
        getAnalyser={getAnalyser}
        playing={playing}
        hueSeed={songHueSeed(current.id)}
      />
      <View
        className="flex-row items-center justify-between gap-3 px-5"
        style={{ paddingTop: insets.top + 4, flexShrink: 0 }}
      >
        <View className="min-w-0 flex-1">
          <Text className="text-[10px] font-semibold uppercase tracking-[2px] text-muted">
            Now playing
          </Text>
          {!compact ? (
            <Text numberOfLines={1} className="mt-1 text-xs text-muted">
              {queueLabel || "Your queue"}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => setFullscreen(true)}
          accessibilityRole="button"
          accessibilityLabel="Fullscreen lyrics"
          className="h-12 justify-center px-3"
        >
          <Text className="text-sm font-semibold text-accent">Fullscreen</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close now playing panel"
          onPress={() => setNowPlayingOpen(false)}
          className="size-12 items-center justify-center active:opacity-60"
        >
          <Icon name="x" size={24} />
        </Pressable>
      </View>
      <View
        className="flex-row items-center gap-4 px-5"
        style={{ paddingVertical: compact ? 6 : 16, flexShrink: 0 }}
      >
        <View
          accessibilityLabel="Song artwork"
          className="overflow-hidden bg-surface-secondary"
          style={{ width: compact ? 48 : 80, height: compact ? 48 : 80 }}
        >
          {current.image ? (
            <Image
              source={{ uri: current.imageLarge || current.image }}
              style={{ width: "100%", height: "100%" }}
              resizeMode="cover"
            />
          ) : (
            <View className="flex-1 items-center justify-center">
              <Icon name="music" size={28} />
            </View>
          )}
        </View>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={2} className="text-xl font-bold tracking-tight text-foreground">
            {current.title}
          </Text>
          <Text numberOfLines={1} className="mt-1 text-sm text-muted">
            {current.artist}
          </Text>
          {!compact && current.album ? (
            <Text numberOfLines={1} className="mt-1 text-xs text-muted">
              {current.album}
            </Text>
          ) : null}
        </View>
      </View>
      <View className="min-h-0 flex-1 px-5">
        <NowPlayingTabs song={current} tab={tab} onTab={chooseTab} />
        <NowPlayingTransport bottomInset={insets.bottom} compact={compact} />
      </View>
    </View>
  );
}
