import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Icon } from "@/components/ui/icons";
import { ClickButton } from "@/components/ui/ClickButton";
import { SongRows, SongTableHead } from "@/components/features/music/SongRows";
import { CollectionHero, RoundPlay } from "@/components/features/music/CollectionHero";
import { formatRuntime } from "@/lib/format";
import { useLibrary } from "@/components/providers/LibraryProvider";
import { useMusicPlayer } from "@/components/providers/MusicPlayerProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { cn } from "@/lib/cn";
import { getPlaylistDetail, searchPlaylists, type PlaylistSummary, Song } from "@/lib/saavn";
import { Scrim, SCRIM_STOPS } from "@/components/ui/Scrim";

type ApiPlaylist = PlaylistSummary;

interface DetailState {
  title: string;
  image: string;
  songs: Song[];
  songCount: number;
  playlistId?: string;
}

/**
 * The playlists tab. The two catalogue calls (`/api/music/playlists` list and
 * detail) are direct `searchPlaylists(query, 8)` / `getPlaylistDetail(id)`
 * against the ported saavn client; the user's own lists stay local to the
 * LibraryProvider exactly like the web. The detail overlay is the web's own
 * fixed dialog (kept structurally identical — flush hero on top, scrollable
 * rows under it), which RN renders with position:fixed.
 */
export function PlaylistsView({ query }: { query: string }) {
  const { playlists, createPlaylist, deletePlaylist, removeFromPlaylist } = useLibrary();
  const { startQueue } = useMusicPlayer();
  const { toast } = useToast();

  const [apiLists, setApiLists] = useState<ApiPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    /* The web deferred the reset a frame (setState-in-effect rule); the same
       frame hop satisfies React 19 here and clears the previous render. */
    const frame = requestAnimationFrame(() => {
      setLoading(true);
      setError(null);
      setDetail(null);
    });

    searchPlaylists(query, 8)
      .then((data) => {
        if (!data) throw new Error("Could not load playlists.");
        if (alive) setApiLists(Array.isArray(data.playlists) ? data.playlists : []);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : "Could not load playlists.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, [query]);

  const openApiPlaylist = async (playlist: ApiPlaylist) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const data = await getPlaylistDetail(playlist.id);
      if (!data) {
        throw new Error("Could not open that playlist.");
      }
      setDetail({
        title: data.title,
        image: data.image,
        songs: data.songs ?? [],
        songCount: data.songCount ?? data.songs?.length ?? 0,
      });
    } catch (cause) {
      toast({
        title: cause instanceof Error ? cause.message : "Could not open that playlist.",
        variant: "error",
      });
    } finally {
      setDetailLoading(false);
    }
  };

  const openMine = (id: string) => {
    const playlist = playlists.find((entry) => entry.id === id);
    if (!playlist) return;
    setDetail({
      title: playlist.name,
      image: playlist.songs[0]?.image ?? "",
      songs: playlist.songs,
      songCount: playlist.songs.length,
      playlistId: playlist.id,
    });
  };

  const removeSong = (song: Song) => {
    if (!detail?.playlistId) return;
    removeFromPlaylist(detail.playlistId, song.id);
    setDetail((current) =>
      current
        ? {
            ...current,
            songs: current.songs.filter((entry) => entry.id !== song.id),
            songCount: Math.max(0, current.songCount - 1),
          }
        : current
    );
    toast({ title: "Removed from playlist", description: song.title });
  };

  const submitNew = () => {
    const id = createPlaylist(newName);
    if (!id) {
      setCreateError("That name is empty or already used.");
      return;
    }
    setNewName("");
    setCreateError(null);
    setCreating(false);
  };

  const detailRuntime = detail
    ? formatRuntime(detail.songs.reduce((sum, song) => sum + (song.duration || 0), 0))
    : "";

  return (
    <View className="mt-8">
      <View className="flex-row flex-wrap items-end justify-between gap-4">
        <View>
          <Text className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">
            Playlists
          </Text>
          <Text className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Your mixes & the catalogue
          </Text>
          <Text className="mt-1 text-sm text-muted">
            Catalogue playlists for <Text className="font-medium text-foreground">“{query}”</Text>,
            plus every playlist you have built here.
          </Text>
        </View>
        <ClickButton
          square
          onClick={() => {
            setCreating((value) => !value);
            setCreateError(null);
          }}
          className="h-10 gap-2 px-4 text-[12px] font-semibold"
        >
          <Icon name="plus" className="size-3.5" />
          New playlist
        </ClickButton>
      </View>

      {creating ? (
        <View className="mt-4 rounded-xl border border-separator bg-surface p-3">
          <View className="flex-col gap-1.5">
            <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Playlist name
            </Text>
            <View className="flex-row gap-2">
              <TextInput
                value={newName}
                onChangeText={(next) => {
                  setNewName(next);
                  setCreateError(null);
                }}
                onSubmitEditing={submitNew}
                maxLength={40}
                placeholder="Late-night drive"
                accessibilityLabel="Playlist name"
                className="h-10 min-w-0 flex-1 rounded-lg border border-separator bg-surface-secondary/50 px-3 text-foreground placeholder:text-faint-foreground"
              />
              <ClickButton
                square
                onClick={submitNew}
                className="h-10 px-4 text-[12px] font-semibold"
              >
                Create
              </ClickButton>
            </View>
            {createError ? (
              <Text className="text-[11px] text-danger-soft-foreground">{createError}</Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {playlists.length ? (
        <View className="mt-6">
          <Text className="pb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
            Your playlists
          </Text>
          <View className="flex-row flex-wrap gap-3">
            {playlists.map((playlist) => (
              <View key={playlist.id} className="relative w-[47%] flex-grow">
                <Pressable
                  accessibilityRole="button"
                  onPress={() => openMine(playlist.id)}
                  className="w-full text-left"
                >
                  <View className="relative aspect-square overflow-hidden rounded-xl border border-separator bg-surface-secondary">
                    {playlist.songs[0]?.image ? (
                      <Image
                        source={{ uri: playlist.songs[0].image }}
                        className="absolute inset-0 size-full"
                        resizeMode="cover"
                      />
                    ) : (
                      <Icon
                        name="list"
                        className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 text-faint-foreground"
                      />
                    )}
                    <Scrim className="absolute inset-0" colors={SCRIM_STOPS.tile} />
                    <Text className="absolute bottom-2 left-2 text-[10px] font-semibold uppercase tracking-wider text-white/75">
                      {playlist.songs.length} {playlist.songs.length === 1 ? "track" : "tracks"}
                    </Text>
                    {/* Spotify's card play button — rests under the tile, lifts
                        on hover and queues the list without opening it. On
                        touch it sits idle (the tile press opens; this badge is
                        the web affordance kept for a pointer). */}
                    <View
                      aria-hidden
                      pointerEvents="none"
                      className="absolute bottom-2 right-2 size-10 translate-y-2 items-center justify-center rounded-full bg-accent text-accent-foreground opacity-0 shadow-pop"
                    >
                      <Icon name="play" size={15} className="fill-current text-accent-foreground" />
                    </View>
                  </View>
                  <Text
                    numberOfLines={1}
                    className="mt-2 block truncate text-sm font-semibold text-foreground"
                  >
                    {playlist.name}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    deletePlaylist(playlist.id);
                    if (detail?.playlistId === playlist.id) setDetail(null);
                  }}
                  accessibilityLabel={`Delete playlist ${playlist.name}`}
                  className="absolute right-2 top-2 size-8 items-center justify-center rounded-full bg-black/50 active:bg-black/70"
                >
                  <Icon name="trash" className="size-3.5 text-white/80" />
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <Text className="mt-6 rounded-xl border border-dashed border-separator px-4 py-6 text-center text-xs text-muted">
          No playlists yet. Create one above, then add songs with the + on any track.
        </Text>
      )}

      <View className="mt-9">
        <View className="flex-row items-baseline justify-between gap-3 pb-3">
          <Text className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
            From the catalogue
          </Text>
          <Text numberOfLines={1} className="truncate text-[10px] text-faint-foreground">
            “{query}”
          </Text>
        </View>

        {loading ? (
          <View className="flex-row flex-wrap gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <View key={index} className="animate-pulse w-[47%] flex-grow">
                <View className="aspect-square rounded-xl bg-surface-secondary" />
                <View className="mt-2 h-3 w-3/4 rounded bg-surface-secondary" />
              </View>
            ))}
          </View>
        ) : error ? (
          <Text className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-xs text-warning-soft-foreground">
            {error} Try another search.
          </Text>
        ) : apiLists.length ? (
          <View className="flex-row flex-wrap gap-3">
            {apiLists.map((playlist) => (
              <Pressable
                key={playlist.id}
                accessibilityRole="button"
                onPress={() => openApiPlaylist(playlist)}
                accessibilityLabel={`Open playlist ${playlist.title}`}
                className="w-[47%] flex-grow"
              >
                <View className="relative aspect-square overflow-hidden rounded-xl border border-separator bg-surface-secondary">
                  {playlist.image ? (
                    <Image
                      source={{ uri: playlist.image }}
                      className="absolute inset-0 size-full"
                      resizeMode="cover"
                    />
                  ) : (
                    <Icon
                      name="music"
                      className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 text-faint-foreground"
                    />
                  )}
                  <Scrim className="absolute inset-0" colors={SCRIM_STOPS.tile} />
                  <View className="absolute bottom-2 left-2 flex-row items-center gap-1.5">
                    <Icon name="list" className="size-3 text-white/80" />
                    <Text className="text-[10px] font-semibold uppercase tracking-wider text-white/80">
                      {playlist.songCount} tracks
                    </Text>
                  </View>
                </View>
                <Text
                  numberOfLines={1}
                  className="mt-2 block truncate text-sm font-semibold text-foreground"
                >
                  {playlist.title}
                </Text>
                <Text numberOfLines={1} className="block truncate text-[11px] text-muted">
                  {playlist.language || "playlist"}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text className="rounded-xl border border-dashed border-separator px-4 py-8 text-center text-xs text-muted">
            No catalogue playlists for this search.
          </Text>
        )}
      </View>

      {detail || detailLoading ? (
        <View
          accessibilityViewIsModal
          className="fixed inset-0 z-50 items-center justify-center bg-black/60 p-4"
        >
          {/* Backdrop tap closes — same as the web overlay. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setDetail(null);
              setDetailLoading(false);
            }}
            accessibilityLabel="Close playlist"
            className="absolute inset-0"
          />
          <View className="relative w-full max-h-[86%] max-w-2xl flex-col overflow-hidden rounded-xl border border-separator bg-surface shadow-pop">
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setDetail(null);
                setDetailLoading(false);
              }}
              accessibilityLabel="Close playlist"
              className="absolute right-3 top-3 z-10 size-9 items-center justify-center rounded-full text-muted active:bg-surface-secondary active:text-foreground"
            >
              <Icon name="x" className="size-4 text-muted" />
            </Pressable>

            <CollectionHero
              flush
              eyebrow="Playlist"
              title={detail?.title ?? "Loading…"}
              image={detail?.image}
              meta={
                detail
                  ? [
                      `${detail.songCount} ${detail.songCount === 1 ? "song" : "songs"}`,
                      detailRuntime,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "Fetching tracks…"
              }
            >
              {detail?.songs.length ? (
                <RoundPlay
                  onClick={() => startQueue(detail.songs, detail.title, 0)}
                  label="Play playlist"
                >
                  <Icon name="play" size={18} className="fill-current text-accent-foreground" />
                </RoundPlay>
              ) : null}
            </CollectionHero>

            <ScrollView
              className={cn(
                "min-h-0 flex-1 p-2 sm:p-3",
                !detail && "items-center justify-center py-16"
              )}
              showsVerticalScrollIndicator={false}
            >
              {detail ? (
                detail.songs.length ? (
                  <>
                    <SongTableHead />
                    <SongRows
                      songs={detail.songs}
                      label={detail.title}
                      onRemove={detail.playlistId ? removeSong : undefined}
                      table
                    />
                  </>
                ) : (
                  <Text className="px-4 py-10 text-center text-xs text-muted">
                    This playlist has no playable tracks.
                  </Text>
                )
              ) : (
                <Text className="text-xs text-muted">Loading tracks…</Text>
              )}
            </ScrollView>
          </View>
        </View>
      ) : null}
    </View>
  );
}
