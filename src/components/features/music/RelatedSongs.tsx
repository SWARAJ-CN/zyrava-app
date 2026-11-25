import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { useLibrary } from "@/components/providers/LibraryProvider";
import { useMusicPlayer } from "@/components/providers/MusicPlayerProvider";
import { tasteProfile, type RelatedPick } from "@/lib/related";
import { buildRadioFor, type FetchPool } from "@/lib/taste";
import { searchSongs } from "@/lib/saavn";
import type { Song } from "@/lib/saavn";

const PICKS = 10;
/** A track's radio run is reused for a while — no refetch on panel reopen. */
const TTL = 10 * 60 * 1000;

const store = new Map<string, { at: number; picks: RelatedPick[] }>();

/** A run only stands for a while — after the TTL the seed is searched again. */
function cachedRun(id: string): RelatedPick[] | undefined {
  const entry = store.get(id);
  return entry && Date.now() - entry.at < TTL ? entry.picks : undefined;
}

function formatSeconds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Live request for one seed id — a reopen during the fetch reuses it. */
const inflight = new Map<string, Promise<RelatedPick[]>>();

/** One catalogue round trip, in the shape the engine asks for — now a DIRECT
 *  call into the ported saavn client (the `/api/music/search` twin). */
const searchPool: FetchPool = async (phrase, limit) => {
  try {
    const { songs } = await searchSongs(phrase, limit);
    return songs;
  } catch {
    return [];
  }
};

/** The same radio the home shelves build — one algorithm, two surfaces. */
async function fetchRelated(song: Song, taste: Set<string>): Promise<RelatedPick[]> {
  return buildRadioFor(song, taste, searchPool, PICKS);
}

/**
 * "Related songs" inside the now playing card.
 *
 * The seed track is broken into search angles (its artists, album, title
 * words, language + mood), the catalogue is asked through the ported saavn
 * client, and the pooled answers are ranked by /lib/related — multi-seed
 * evidence, weighted content similarity, the listener's own taste, then an MMR
 * pass so the run stays varied. The module cache (10 min TTL) and the
 * single-flight map are verbatim.
 */
export function RelatedSongs({ song }: { song: Song }) {
  const { startQueue } = useMusicPlayer();
  const { liked, playlists } = useLibrary();

  /* The cache answers while a run is fresh; state only carries what an
   * in-flight request lands with, so switching seeds never needs a reset
   * pass through the effect. */
  const [settled, setSettled] = useState<{ id: string; picks: RelatedPick[] } | null>(null);
  const picks = settled?.id === song.id ? settled.picks : cachedRun(song.id);
  const loading = !picks;

  useEffect(() => {
    if (picks) return;

    let running = inflight.get(song.id);
    if (!running) {
      const taste = tasteProfile([...liked, ...playlists.flatMap((playlist) => playlist.songs)]);
      running = fetchRelated(song, taste).then((ranked) => {
        // Empty stays uncached, so a hiccup on one search is retried later.
        if (ranked.length) store.set(song.id, { at: Date.now(), picks: ranked });
        return ranked;
      });
      inflight.set(song.id, running);
      // The cleanup chain must not become a second, unhandled rejection.
      void running.catch(() => undefined).finally(() => inflight.delete(song.id));
    }

    let alive = true;
    running
      .then((ranked) => {
        if (alive) setSettled({ id: song.id, picks: ranked });
      })
      .catch(() => {
        if (alive) setSettled({ id: song.id, picks: [] });
      });
    return () => {
      alive = false;
    };
  }, [picks, song, liked, playlists]);

  const shown = picks ?? [];
  const songs = shown.map((pick) => pick.song);
  const label = `Radio · ${song.title}`;

  return (
    <View className="mt-3 min-h-0 flex-1 flex-col">
      <View className="flex-row flex-none items-center gap-2">
        <View className="min-w-0 flex-1">
          <Text className="text-base font-semibold text-foreground">Keep listening</Text>
          <Text numberOfLines={1} className="truncate pt-1 text-xs text-muted">
            Because you&apos;re playing {song.title}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => startQueue(songs, label, 0)}
          disabled={!shown.length}
          accessibilityLabel="Play related songs"
          className="ml-auto min-h-11 flex-row items-center justify-center gap-2 bg-accent-soft px-3 active:opacity-70 disabled:opacity-40"
        >
          <Icon name="play" size={15} className="text-accent-soft-foreground" />
          <Text className="text-xs font-semibold text-accent-soft-foreground">Play all</Text>
        </Pressable>
      </View>

      <ScrollView
        className="mt-2 min-h-0 flex-1"
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 20 }}
      >
        {loading ? (
          <View className="flex-col gap-1.5">
            {Array.from({ length: 4 }).map((_, index) => (
              <View key={index} className="animate-pulse flex-row items-center gap-2.5 px-1 py-1.5">
                <View className="size-12 flex-none bg-surface-secondary" />
                <View className="min-w-0 flex-1">
                  <View className="h-3 w-3/4 rounded bg-surface-secondary" />
                  <View className="mt-1.5 h-2.5 w-1/2 rounded bg-surface-secondary" />
                </View>
              </View>
            ))}
          </View>
        ) : !shown.length ? (
          <Text className="py-8 text-sm text-muted">
            No related tracks found for this song yet.
          </Text>
        ) : (
          <View className="flex-col gap-2">
            {shown.map((pick, index) => (
              <PickRow
                key={pick.song.id}
                pick={pick}
                index={index}
                songs={songs}
                label={label}
                liked={liked.some((entry) => entry.id === pick.song.id)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/** One radio row — the web's hover-revealed play badge and like button are
 *  always visible on touch, and press swaps the badge over the cover. */
function PickRow({
  pick,
  index,
  songs,
  label,
  liked,
}: {
  pick: RelatedPick;
  index: number;
  songs: Song[];
  label: string;
  liked: boolean;
}) {
  const { startQueue } = useMusicPlayer();
  const { toggleLike } = useLibrary();
  const [pressed, setPressed] = useState(false);

  return (
    <View className="w-full flex-row items-center gap-2 py-3">
      <Pressable
        accessibilityRole="button"
        onPress={() => startQueue(songs, label, index)}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        accessibilityLabel={`Play ${pick.song.title} by ${pick.song.artist}`}
        style={{ flexDirection: "row", alignItems: "center", flex: 1, minWidth: 0, gap: 10 }}
      >
        <View
          style={{ width: 52, height: 52, flexShrink: 0 }}
          className="overflow-hidden bg-surface-secondary"
        >
          {pick.song.image ? (
            <Image
              source={{ uri: pick.song.image }}
              style={[StyleSheet.absoluteFill, { width: 52, height: 52 }]}
              resizeMode="cover"
            />
          ) : (
            <Icon name="music" className="m-auto size-4 text-faint-foreground" />
          )}
          <View
            className={cn(
              "absolute inset-0 items-center justify-center bg-black/45 transition-opacity",
              pressed ? "opacity-100" : "opacity-0"
            )}
          >
            <Icon name="play" className="size-3 fill-white text-white" />
          </View>
        </View>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="block truncate text-sm font-semibold text-foreground">
            {pick.song.title}
          </Text>
          <Text numberOfLines={1} className="mt-1 block truncate text-xs text-muted">
            {pick.song.artist}
          </Text>
        </View>
      </Pressable>
      <Text className="flex-none text-[11px] tabular-nums text-faint-foreground">
        {formatSeconds(pick.song.duration)}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => toggleLike(pick.song)}
        accessibilityState={{ selected: liked }}
        accessibilityLabel={
          liked ? `Remove ${pick.song.title} from Liked songs` : `Like ${pick.song.title}`
        }
        className="size-10 flex-none shrink-0 items-center justify-center rounded-full"
      >
        <Icon
          name="heart"
          className="size-4 text-muted"
          color={liked ? "#ff0000" : undefined}
          fill={liked ? "#ff0000" : "none"}
        />
      </Pressable>
    </View>
  );
}
