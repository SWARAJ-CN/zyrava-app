import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
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
  const seconds = Math.round(value % 60);
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

  if (!loading && !picks?.length) return null;

  const shown = picks ?? [];
  const songs = shown.map((pick) => pick.song);
  const label = `Radio · ${song.title}`;

  return (
    <View className="mt-5 min-h-0 flex-1 flex-col">
      <View className="flex-row flex-none items-center gap-2">
        <View className="min-w-0">
          <Text className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
            Related songs
          </Text>
          <Text numberOfLines={1} className="truncate pt-0.5 text-[11px] text-faint-foreground">
            Because you&apos;re playing {song.title}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => startQueue(songs, label, 0)}
          disabled={!shown.length}
          accessibilityLabel="Play related songs"
          className="ml-auto size-9 flex-none items-center justify-center rounded-full bg-accent text-accent-foreground shadow-field transition-transform duration-150 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
        >
          <Icon name="play" size={15} className="fill-current" />
        </Pressable>
      </View>

      <ScrollView
        className="mt-2 min-h-0 flex-1"
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        contentContainerStyle={{ paddingBottom: 4 }}
      >
        {loading ? (
          <View className="flex-col gap-1.5">
            {Array.from({ length: 4 }).map((_, index) => (
              <View key={index} className="animate-pulse flex-row items-center gap-2.5 px-1 py-1.5">
                <View className="size-10 flex-none rounded-md bg-surface-secondary" />
                <View className="min-w-0 flex-1">
                  <View className="h-3 w-3/4 rounded bg-surface-secondary" />
                  <View className="mt-1.5 h-2.5 w-1/2 rounded bg-surface-secondary" />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View className="flex-col gap-0.5">
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
    <View className="flex-row w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors active:bg-surface-secondary">
      <Pressable
        accessibilityRole="button"
        onPress={() => startQueue(songs, label, index)}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        accessibilityLabel={`Play ${pick.song.title} by ${pick.song.artist}`}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <View className="relative size-10 flex-none overflow-hidden rounded-md bg-surface-muted">
          {pick.song.image ? (
            <Image
              source={{ uri: pick.song.image }}
              className="absolute inset-0 size-full"
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
          <Text
            numberOfLines={1}
            className="block truncate text-[13px] font-semibold text-foreground"
          >
            {pick.song.title}
          </Text>
          <Text numberOfLines={1} className="block truncate text-[11px] text-muted">
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
        className="size-7 flex-none shrink-0 items-center justify-center rounded-full"
      >
        <Icon
          name="heart"
          className={cn("size-4 text-muted", liked && "fill-danger text-danger")}
        />
      </Pressable>
    </View>
  );
}
