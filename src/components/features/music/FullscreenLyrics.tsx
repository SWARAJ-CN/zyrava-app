import { useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMusicPlayer, usePlaybackProgress } from "@/components/providers/MusicPlayerProvider";
import { useCustomization } from "@/components/providers/CustomizationProvider";
import { usePanelBackHandler } from "@/hooks/usePanelBackHandler";
import { Animation } from "@/components/ui/Animation";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/components/ui/icons";
import { LyricsPanel } from "./LyricsPanel";
import { NowPlayingTransport } from "./NowPlayingTransport";
import { formatSeconds } from "@/lib/lyrics";

const CHARACTERS = [
  { id: "moments-2", name: "Dancing dog" },
  { id: "moments-4", name: "Skeleton groove" },
  { id: "moments-3", name: "DJ groove" },
] as const;
type Character = (typeof CHARACTERS)[number]["id"];
function Timer() {
  const { progress, duration } = usePlaybackProgress();
  return (
    <Text className="mt-2 text-center text-xs tabular-nums text-muted">
      {formatSeconds(progress)} / {formatSeconds(duration)}
    </Text>
  );
}

export function FullscreenLyrics({ onClose }: { onClose: () => void }) {
  const { current, playing } = useMusicPlayer();
  const { config, personalTheme } = useCustomization();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = width >= 700;
  const [character, setCharacter] = useState<Character | null>(null);
  const [choosing, setChoosing] = useState(false);
  usePanelBackHandler(true, () => (choosing ? setChoosing(false) : onClose()));
  if (!current) return null;
  const art = current.imageLarge || current.image;
  const artSize = wide
    ? Math.min(width * 0.43, height * 0.64)
    : Math.min(width - 64, height * 0.28);
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { zIndex: 60, paddingTop: insets.top, paddingHorizontal: 20 },
      ]}
      className="bg-background"
      accessibilityViewIsModal
    >
      {art ? (
        <Image
          pointerEvents="none"
          source={{ uri: art }}
          blurRadius={60}
          resizeMode="cover"
          style={[StyleSheet.absoluteFill, { opacity: 0.18 }]}
        />
      ) : null}
      <View className="flex-row items-center justify-between gap-2 py-2">
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Exit fullscreen lyrics"
          className="size-11 items-center justify-center"
        >
          <Icon name="x" size={24} />
        </Pressable>
        <View className="flex-row items-center gap-2">
          {character ? (
            <Pressable onPress={() => setChoosing(true)} accessibilityRole="button">
              <Text className="text-xs text-accent">Change character</Text>
            </Pressable>
          ) : null}
          <Text className="text-sm text-foreground">Dancing mode</Text>
          <Switch
            accessibilityLabel="Dancing mode"
            value={!!character}
            onValueChange={(on) => (on ? setChoosing(true) : setCharacter(null))}
          />
        </View>
      </View>
      <View
        style={{ flex: 1, minHeight: 0, flexDirection: wide ? "row" : "column-reverse", gap: 16 }}
      >
        <View style={{ flex: 1, minHeight: 0 }}>
          <LyricsPanel song={current} large />
        </View>
        <View
          style={{ alignItems: "center", justifyContent: "center", width: wide ? "45%" : "100%" }}
        >
          {character ? (
            <Animation
              id={character}
              playing={playing}
              style={{ width: wide ? "100%" : artSize * 1.3, height: artSize }}
            />
          ) : art ? (
            <Image
              source={{ uri: art }}
              resizeMode="contain"
              style={{ width: artSize, height: artSize, borderRadius: 18 }}
            />
          ) : (
            <View
              style={{
                width: artSize,
                height: artSize,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="music" size={60} />
            </View>
          )}
          <Timer />
          <Text
            numberOfLines={1}
            className="mt-2 text-center text-sm font-semibold text-foreground"
          >
            {current.title}
          </Text>
          {!character && (personalTheme || config?.lyricsAnimation) ? (
            <View
              pointerEvents="none"
              style={{ position: "absolute", right: 0, bottom: 20, opacity: 0.55 }}
            >
              <Animation
                id={personalTheme ? "lyrics-heart" : config!.lyricsAnimation}
                playing={playing}
                style={{ width: 85, height: 85 }}
              />
            </View>
          ) : null}
        </View>
      </View>
      <NowPlayingTransport compact bottomInset={insets.bottom} />
      <Modal
        open={choosing}
        onClose={() => setChoosing(false)}
        title="Choose your dancing character"
        description="Your character dances while the music plays."
      >
        {CHARACTERS.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => {
              setCharacter(item.id);
              setChoosing(false);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Choose ${item.name}`}
            className="flex-row items-center gap-4 rounded-2xl bg-surface-secondary px-3"
          >
            <Animation id={item.id} style={{ width: 100, height: 100 }} />
            <Text className="text-base font-semibold text-foreground">{item.name}</Text>
          </Pressable>
        ))}
      </Modal>
    </View>
  );
}
