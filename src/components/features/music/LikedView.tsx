import { useCallback, useMemo, type ReactElement } from "react";
import { ActivityIndicator, FlatList, Text, View, type ListRenderItemInfo } from "react-native";
import { Icon } from "@/components/ui/icons";
import {
  CollectionHero,
  OutlineAction,
  RoundPlay,
} from "@/components/features/music/CollectionHero";
import { SongRow, SongTableHead } from "@/components/features/music/SongRows";
import { useLibrary } from "@/components/providers/LibraryProvider";
import { useMusicPlayer } from "@/components/providers/MusicPlayerProvider";
import { useOffline } from "@/components/providers/OfflineProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { cn } from "@/lib/cn";
import { formatRuntime } from "@/lib/format";
import type { Song } from "@/lib/saavn";

function totalSeconds(songs: Song[]): number {
  return songs.reduce((sum, song) => sum + (song.duration || 0), 0);
}

/** The private collection tab — Spotify's Liked Songs screen. */
export function LikedView({
  header,
  paddingBottom = 32,
}: {
  header?: ReactElement;
  paddingBottom?: number;
}) {
  const { liked, loading } = useLibrary();
  const { startQueue, shuffle, toggleShuffle } = useMusicPlayer();
  const { toast } = useToast();
  const { savedIds, progress, saving, saveAll } = useOffline();

  const playAll = () => {
    if (!liked.length) {
      toast({ title: "Nothing liked yet", description: "Tap the heart on any song." });
      return;
    }
    startQueue(liked, "Liked songs", 0);
  };

  /** Same mix-then-play move the library list uses, so shuffle never dead-ends. */
  const shufflePlay = () => {
    if (!liked.length) {
      toast({ title: "Nothing liked yet", description: "Tap the heart on any song." });
      return;
    }
    // Fisher–Yates, verbatim.
    const mixed = [...liked];
    for (let i = mixed.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [mixed[i], mixed[j]] = [mixed[j], mixed[i]];
    }
    if (!shuffle) toggleShuffle();
    startQueue(mixed, "Liked songs", 0);
  };

  const length = useMemo(() => formatRuntime(totalSeconds(liked)), [liked]);
  const allSaved = useMemo(
    () => liked.length > 0 && liked.every((song) => savedIds.has(song.id)),
    [liked, savedIds]
  );

  /** Songs finished, plus how far the one still coming through has got. */
  const active = saving ? Object.values(progress)[0] : undefined;
  const fraction = active && active.total > 0 ? active.loaded / active.total : 0;
  const percent = saving
    ? Math.min(100, Math.round(((saving.done + fraction) / saving.total) * 100))
    : 0;

  const collectionHeader = (
    <>
      {header}
      <View className="mt-8">
        <CollectionHero
          eyebrow="Collection"
          title="Liked songs"
          glyph="heart"
          image={liked[0]?.image}
          meta={`${liked.length} ${liked.length === 1 ? "song" : "songs"}${
            length ? ` · ${length}` : ""
          } · saved to your account`}
        >
          <RoundPlay onClick={playAll} disabled={!liked.length} label="Play all liked songs">
            <Icon name="play" size={18} className="fill-current text-accent-foreground" />
          </RoundPlay>
          <OutlineAction
            onClick={shufflePlay}
            disabled={!liked.length}
            active={shuffle}
            label="Shuffle liked songs"
          >
            <Icon name="shuffle" className="size-4.5" />
          </OutlineAction>
          <OutlineAction
            onClick={() => void saveAll(liked)}
            disabled={!liked.length || allSaved || saving !== null}
            active={allSaved}
            label={
              allSaved
                ? "Every liked song is on this device"
                : "Keep every liked song on this device"
            }
          >
            <Icon
              name={saving ? "loader" : "download"}
              className={cn("size-4.5", saving && "motion-safe:animate-spin")}
            />
          </OutlineAction>
        </CollectionHero>

        {saving ? (
          <View className="mt-3 rounded-xl border border-separator bg-surface px-3 py-2.5">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="text-[11px] text-muted">
                Saving song {Math.min(saving.done + 1, saving.total)} of {saving.total} on this
                device
              </Text>
              <Text className="text-[11px] font-semibold tabular-nums text-foreground">
                {percent}%
              </Text>
            </View>
            {/* Width-percentage bar — RN accepts the same % string the web used. */}
            <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-secondary">
              <View className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
            </View>
          </View>
        ) : null}

        {liked.length ? (
          <View className="mt-6 pt-2">
            <SongTableHead />
          </View>
        ) : null}
      </View>
    </>
  );
  const renderSong = useCallback(
    ({ item, index }: ListRenderItemInfo<Song>) => (
      <View className="pb-1">
        <SongRow song={item} index={index} songs={liked} label="Liked songs" table />
      </View>
    ),
    [liked]
  );

  return (
    <FlatList
      className="flex-1 bg-background"
      data={liked}
      keyExtractor={(song) => song.id}
      renderItem={renderSong}
      ListHeaderComponent={collectionHeader}
      ListEmptyComponent={
        loading ? (
          <View
            className="items-center gap-3 py-12"
            accessibilityRole="progressbar"
            accessibilityLabel="Loading liked songs"
          >
            <ActivityIndicator />
            <Text className="text-sm text-muted">Loading liked songs…</Text>
          </View>
        ) : (
          <View className="items-center justify-center gap-3 px-6 py-16 text-center">
            <View className="size-12 items-center justify-center rounded-full bg-danger-soft text-danger-soft-foreground">
              <Icon name="heart" className="size-5" />
            </View>
            <View>
              <Text className="text-sm font-semibold text-foreground">No liked songs yet</Text>
              <Text className="mt-1 text-xs text-muted">
                Tap the heart on any song in the catalogue and it lands here.
              </Text>
            </View>
          </View>
        )
      }
      initialNumToRender={8}
      maxToRenderPerBatch={6}
      updateCellsBatchingPeriod={32}
      windowSize={5}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingTop: 20, paddingBottom }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    />
  );
}
