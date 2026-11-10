import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CollectionHero } from "@/components/features/music/CollectionHero";
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
      <View className="mt-5">
        <Card id="for-you">
          <CardContent className="p-3 sm:p-4">
            <Skeleton className="h-28 w-full rounded-xl" />
          </CardContent>
        </Card>
      </View>
    ) : null;
  }

  const seeds = vector?.seeds ?? [];
  const cover =
    mix?.picks[0]?.song.imageLarge ?? mix?.seed?.imageLarge ?? seeds[0]?.song.imageLarge ?? "";

  return (
    <View className="mt-5">
      <Card id="for-you">
        <CardHeader
          title="Made for you"
          description="Built from what you play here"
          actions={
            <Pressable
              accessibilityRole="button"
              onPress={refresh}
              disabled={building}
              accessibilityLabel="Build these picks again"
              className="size-8 items-center justify-center rounded-full text-muted transition-colors active:bg-surface-secondary active:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <Icon
                name="refresh"
                className={`size-4${building ? " motion-safe:animate-spin" : ""}`}
              />
            </Pressable>
          }
        />

        <CardContent className="p-3 sm:p-4">
          {count > 0 && mix ? (
            <CollectionHero
              eyebrow="Made for you"
              title="Your mix"
              meta={`${count} songs · from what you have been playing`}
              image={cover}
              tone="brand"
            >
              <View className="flex-row items-center gap-2">
                <PlayButton
                  label="Play your mix"
                  solid
                  onPress={() => startQueue(pickSongs(mix), "Your mix", 0)}
                />
                <PlayButton
                  label="Shuffle your mix"
                  icon="shuffle"
                  onPress={() => {
                    const songs = pickSongs(mix);
                    startQueue(songs, "Your mix", Math.floor(Math.random() * songs.length));
                  }}
                />
              </View>
            </CollectionHero>
          ) : null}

          {count > 0 && mix ? <Row shelf={mix} onPlay={startQueue} first={count > 0} /> : null}
          {rows.map((shelf) => (
            <Row key={`${shelf.key}-${shelf.title}`} shelf={shelf} onPlay={startQueue} />
          ))}

          <View className="mt-4 flex-row items-center justify-end border-t border-separator pt-3">
            <Pressable
              accessibilityRole="button"
              onPress={() => setConfirming(true)}
              className="transition-colors active:opacity-70"
            >
              <Text className="text-[11px] font-medium text-muted active:text-foreground">
                Start over
              </Text>
            </Pressable>
          </View>
        </CardContent>
      </Card>

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
  onPress,
  icon = "play",
  solid = false,
}: {
  label: string;
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
          ? "size-11 items-center justify-center rounded-full bg-brand text-white transition-transform active:scale-95"
          : "size-11 items-center justify-center rounded-full border border-separator text-muted transition-colors active:border-border-strong active:text-foreground"
      }
    >
      <Icon name={icon} className={solid ? "size-4 text-white" : "size-4"} />
    </Pressable>
  );
}

/** One shelf: square tiles, the second caption line being the reason it is here. */
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
    <View className={first ? "mt-5" : "mt-2"}>
      <View className="flex-row items-baseline justify-between gap-3 pb-2.5">
        <Text
          numberOfLines={1}
          className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-muted"
        >
          {label}
        </Text>
        <Text className="flex-none text-[11px] font-medium text-faint-foreground">
          {songs.length}
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
              accessibilityLabel={`Play ${song.title}, ${reason}`}
              className="w-28 flex-none"
            >
              <View className="relative aspect-square overflow-hidden rounded-full border border-separator bg-surface-secondary">
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
                <View className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                {/* The hover play badge lands mid-tile on native so it is
                    always reachable: a press plays, this only marks intent. */}
                <View className="absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-brand/90 opacity-0 transition-opacity active:opacity-100">
                  <Icon name="play" className="size-3 text-white" />
                </View>
              </View>
              <Text
                numberOfLines={1}
                className="mt-1.5 block truncate text-[11px] font-semibold text-foreground"
              >
                {song.title}
              </Text>
              <Text numberOfLines={1} className="block truncate text-[10px] text-muted">
                {reason}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
