import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { Icon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useMusicPlayer } from "@/components/providers/MusicPlayerProvider";
import { useTaste } from "@/components/providers/TasteProvider";
import type { Shelf, ShelfKey } from "@/lib/taste";
import type { Song } from "@/lib/saavn";

/**
 * The shelves the taste engine built from what the listener has been doing.
 *
 * IntersectionObserver has no native twin: the card is built lazily anyway,
 * so the swap is a plain "ask on mount" — `ensureBuilt()` fires the first
 * time this component appears. (The web's 300px rootMargin pre-warm and the
 * 1px hidden-shell trick are dropped with the observer; everything the
 * shelves do after building is verbatim.)
 */

const ROW_TITLES: Record<ShelfKey, string> = {
  mix: "Your mix",
  radio: "Because you played",
  explore: "Exploring",
  repeat: "On repeat",
};

export function Recommendations() {
  const { shelves, building, vector, ensureBuilt, refresh, reset } = useTaste();
  const { startQueue } = useMusicPlayer();
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  /* On-view build request → mount request (see header note). */
  useEffect(() => {
    ensureBuilt();
  }, [ensureBuilt]);

  const mix = shelves?.mix ?? null;
  const rows = (["radio", "repeat", "explore"] as ShelfKey[])
    .map((key) => shelves?.[key] ?? null)
    .filter(
      (shelf): shelf is Shelf => !!shelf && shelf.picks.length >= (shelf.key === "explore" ? 4 : 3)
    );

  const count = mix?.picks.length ?? 0;
  // Silent until there is something to show: no empty state, no placeholder prose.
  if (!count && !rows.length) {
    return building ? (
      <View nativeID="for-you" className="mt-8 gap-5">
        <Skeleton className="h-6 w-40 rounded-none" />
        <View className="flex-row items-center gap-4">
          <Skeleton className="size-24 rounded-none" />
          <View className="flex-1 gap-3">
            <Skeleton className="h-5 w-3/4 rounded-none" />
            <Skeleton className="h-3 w-1/2 rounded-none" />
          </View>
        </View>
      </View>
    ) : null;
  }

  const seeds = vector?.seeds ?? [];
  const cover =
    mix?.picks[0]?.song.imageLarge ?? mix?.seed?.imageLarge ?? seeds[0]?.song.imageLarge ?? "";

  return (
    <View nativeID="for-you" className="mt-8">
      <View className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text accessibilityRole="header" className="text-xl font-bold text-foreground">
            Made for you
          </Text>
          <Text className="mt-1 text-xs text-muted">Based on your listening</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh your recommendations"
          accessibilityState={{ disabled: building, busy: building }}
          onPress={refresh}
          disabled={building}
          className="min-h-11 flex-row items-center gap-2 px-1 active:opacity-60 disabled:opacity-40"
        >
          <Icon name="refresh" className="size-4 text-muted" />
          <Text className="text-xs font-medium text-muted">
            {building ? "Refreshing…" : "Refresh"}
          </Text>
        </Pressable>
      </View>

      {count > 0 && mix ? (
        <View className="mt-5">
          <View className="flex-row items-center gap-4">
            <View className="size-24 shrink-0 overflow-hidden bg-surface-secondary">
              {cover ? (
                <Image source={{ uri: cover }} className="size-full" resizeMode="cover" />
              ) : (
                <View className="flex-1 items-center justify-center">
                  <Icon name="music" className="size-8 text-muted" />
                </View>
              )}
            </View>
            <View className="min-w-0 flex-1">
              <Text accessibilityRole="header" className="text-2xl font-semibold text-foreground">
                Your mix
              </Text>
              <Text className="mt-1 text-sm text-muted">
                {count} {count === 1 ? "song" : "songs"}
              </Text>
            </View>
          </View>
          <View className="mt-4 flex-row flex-wrap gap-3">
            <PlayButton
              label="Play your mix"
              text="Play mix"
              solid
              onPress={() => startQueue(pickSongs(mix), "Your mix", 0)}
            />
            <PlayButton
              label="Shuffle your mix"
              text="Shuffle"
              icon="shuffle"
              onPress={() => {
                const songs = pickSongs(mix);
                for (let index = songs.length - 1; index > 0; index -= 1) {
                  const other = Math.floor(Math.random() * (index + 1));
                  [songs[index], songs[other]] = [songs[other], songs[index]];
                }
                startQueue(songs, "Your mix", 0);
              }}
            />
          </View>
        </View>
      ) : null}

      {count > 0 && mix ? <Row shelf={mix} onPlay={startQueue} first /> : null}
      {rows.map((shelf) => (
        <Row key={`${shelf.key}-${shelf.title}`} shelf={shelf} onPlay={startQueue} />
      ))}

      <View className="mt-4 items-end">
        <Pressable
          accessibilityRole="button"
          onPress={() => setConfirming(true)}
          className="min-h-11 justify-center active:opacity-60"
        >
          <Text className="text-xs text-muted">Reset recommendations</Text>
        </Pressable>
      </View>

      <ConfirmDialog
        open={confirming}
        title="Clear what we have learned?"
        description="Your listening history and these picks will start from zero. Liked songs and playlists are untouched."
        confirmLabel="Clear history"
        destructive
        loading={clearing}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setClearing(true);
          void reset().finally(() => {
            setClearing(false);
            setConfirming(false);
          });
        }}
      />
      {/* The web kept a hidden `data-shown={lastShown}` marker span; there is
          no DOM attribute to mirror natively and `lastShown` is only read by
          the taste engine itself, so the node is dropped. */}
    </View>
  );
}

function pickSongs(shelf: Shelf): Song[] {
  return shelf.picks.map((pick) => pick.song);
}

function PlayButton({
  label,
  text,
  onPress,
  icon = "play",
  solid = false,
}: {
  label: string;
  text: string;
  onPress: () => void;
  icon?: "play" | "shuffle";
  solid?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      accessibilityLabel={label}
      className={
        solid
          ? "min-h-11 flex-row items-center justify-center gap-2 bg-brand px-5 active:opacity-80"
          : "min-h-11 flex-row items-center justify-center gap-2 bg-surface-secondary px-5 active:opacity-70"
      }
    >
      <Icon
        name={icon}
        className={solid ? "size-4 text-brand-foreground" : "size-4 text-foreground"}
      />
      <Text
        className={
          solid
            ? "text-sm font-semibold text-brand-foreground"
            : "text-sm font-semibold text-foreground"
        }
      >
        {text}
      </Text>
    </Pressable>
  );
}

/** Clear shelf headings and square artwork with song and artist captions. */
function Row({
  shelf,
  onPlay,
  first = false,
}: {
  shelf: Shelf;
  onPlay: (list: Song[], label: string, index: number) => void;
  first?: boolean;
}) {
  const songs = pickSongs(shelf);
  const label = shelf.key === "radio" ? shelf.title : ROW_TITLES[shelf.key];
  return (
    <View className="mt-6">
      <View className="flex-row items-baseline justify-between gap-3 pb-2.5">
        <Text
          accessibilityRole="header"
          numberOfLines={2}
          className="min-w-0 flex-1 text-base font-semibold text-foreground"
        >
          {first ? "In this mix" : label}
        </Text>
        <Text className="flex-none text-[11px] font-medium text-faint-foreground">
          {songs.length} {songs.length === 1 ? "song" : "songs"}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 12, paddingBottom: 4 }}
      >
        {songs.map((song, index) => {
          const pick = shelf.picks[index];
          const reason = pick?.reason ?? "Sounds similar";
          return (
            <Pressable
              key={`${shelf.key}-${song.id}`}
              accessibilityRole="button"
              onPress={() => onPlay(songs, label, index)}
              accessibilityLabel={`Play ${song.title} by ${song.artist}, ${reason}`}
              className="w-28 flex-none active:opacity-70"
            >
              <View className="relative aspect-square overflow-hidden bg-surface-secondary">
                {song.imageLarge || song.image ? (
                  <Image
                    source={{ uri: song.imageLarge || song.image }}
                    className="absolute inset-0 size-full"
                    resizeMode="cover"
                  />
                ) : (
                  <Icon
                    name="music"
                    className="absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 text-faint-foreground"
                  />
                )}
              </View>
              <Text numberOfLines={1} className="mt-2 text-sm font-medium text-foreground">
                {song.title}
              </Text>
              <Text numberOfLines={1} className="mt-0.5 text-xs text-muted">
                {song.artist || reason}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
