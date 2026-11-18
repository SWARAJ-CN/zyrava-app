import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Pressable, ScrollView, TextInput, Text, View } from "react-native";
import { getItem, setItem } from "@/lib/store";
import { randomUUID } from "@/lib/uuid";
import { Icon } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useAuth } from "@/components/providers/AuthProvider";
import { useGuestLock } from "@/components/providers/GuestLockProvider";
import { useMusicPlayer } from "@/components/providers/MusicPlayerProvider";
import { useTaste } from "@/components/providers/TasteProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { cn } from "@/lib/cn";
import { onCommunityEvent, onCommunityStatus } from "@/lib/socket";
import {
  createServerPlaylist,
  deleteServerPlaylist,
  dropLike,
  dropPlaylistSong,
  fetchLibrary,
  saveLikes,
  savePlaylistSongs,
  type ServerLibrary,
} from "@/lib/library";
import type { Song } from "@/lib/saavn";

export interface Playlist {
  id: string;
  name: string;
  songs: Song[];
  createdAt: number;
}

interface LibraryState {
  liked: Song[];
  playlists: Playlist[];
}

interface LibraryContextValue {
  loading: boolean;
  liked: Song[];
  playlists: Playlist[];
  isLiked: (song: Song) => boolean;
  toggleLike: (song: Song) => void;
  createPlaylist: (name: string) => string | null;
  addToPlaylist: (playlistId: string, song: Song) => void;
  removeFromPlaylist: (playlistId: string, songId: string) => void;
  deletePlaylist: (id: string) => void;
  playLiked: () => void;
  playPlaylist: (id: string) => void;
  openPicker: (song: Song) => void;
  closePicker: () => void;
}

const EMPTY: LibraryState = { liked: [], playlists: [] };
const MAX_PLAYLISTS = 30;
const MAX_NAME = 40;

const LibraryContext = createContext<LibraryContextValue | null>(null);

function storageKey(userId: string) {
  return `zyrava-library:${userId}`;
}

function readLibrary(userId: string): LibraryState {
  try {
    const raw = getItem(storageKey(userId));
    const parsed = raw ? (JSON.parse(raw) as Partial<LibraryState>) : null;
    if (!parsed || typeof parsed !== "object") return EMPTY;
    return {
      liked: Array.isArray(parsed.liked) ? parsed.liked : [],
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
    };
  } catch {
    return EMPTY;
  }
}

function newId() {
  /* crypto.randomUUID with the web's own fallback shape — @/lib/uuid. */
  return randomUUID();
}

/** The account's library, in the shape the app already works with. */
function fromServer(server: ServerLibrary): LibraryState {
  return {
    liked: server.liked ?? [],
    playlists: (server.playlists ?? []).map((playlist) => ({
      id: playlist.key,
      name: playlist.name,
      songs: playlist.songs ?? [],
      createdAt: Date.parse(playlist.createdAt) || 0,
    })),
  };
}

function hasNothing(library: LibraryState) {
  return !library.liked.length && !library.playlists.length;
}

/**
 * Lifts a library that only existed on this device onto the account. Oldest
 * rows go first so the server's own write order reads back the same way.
 */
async function uploadLibrary(local: LibraryState): Promise<void> {
  await saveLikes([...local.liked].reverse());
  for (const playlist of [...local.playlists].reverse()) {
    await createServerPlaylist(playlist.id, playlist.name);
    await savePlaylistSongs(playlist.id, playlist.songs);
  }
}

/**
 * The signed-in account's likes and playlists. They live in the database and
 * this device keeps a working copy of them for when the API cannot be reached.
 */
export function LibraryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { requireAuth } = useGuestLock();
  const { startQueue } = useMusicPlayer();
  const { success, toast } = useToast();
  const { record } = useTaste();

  const userId = user?.id ?? null;
  const accountRef = useRef(userId);
  useEffect(() => {
    accountRef.current = userId;
  }, [userId]);
  const [resolvedFor, setResolvedFor] = useState<string | null>(null);
  const loading = userId !== null && resolvedFor !== userId;
  // Storage was hydrated before providers mounted: paint this account's cache
  // synchronously, then reconcile in the background. Keep the owner with the
  // snapshot so switching accounts can never expose/persist the previous one.
  const cached = useMemo(() => (userId ? readLibrary(userId) : EMPTY), [userId]);
  const [snapshot, setSnapshot] = useState(() => ({ owner: userId, library: cached }));
  const state = snapshot.owner === userId ? snapshot.library : cached;
  const setState = useCallback(
    (next: SetStateAction<LibraryState>) => {
      setSnapshot((previous) => {
        const base = previous.owner === userId ? previous.library : cached;
        return { owner: userId, library: typeof next === "function" ? next(base) : next };
      });
    },
    [userId, cached]
  );
  const mutationRevision = useRef(0);
  const [pickerSong, setPickerSong] = useState<Song | null>(null);
  const [newName, setNewName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);
  const latest = useRef(state);

  useEffect(() => {
    latest.current = state;
  }, [state]);

  // Load (and reset) per account: the account's library is the copy of record,
  // this device's storage is the cache it falls back to when the API is down.
  useEffect(() => {
    loadedFor.current = null;
    if (!userId) {
      const reset = requestAnimationFrame(() => {
        setState(EMPTY);
        setPickerSong(null);
      });
      return () => cancelAnimationFrame(reset);
    }

    let alive = true;
    const revision = mutationRevision.current;
    void (async () => {
      const local = cached;
      let server: ServerLibrary | null = null;
      try {
        server = await fetchLibrary();
      } catch {
        server = null;
      }
      if (!alive) return;
      loadedFor.current = userId;
      setResolvedFor(userId);
      // The cached list is already interactive. A slow response must not
      // replace a like/unlike made while this initial fetch was in flight.
      if (!server || revision !== mutationRevision.current) return;

      const remote = fromServer(server);
      if (hasNothing(remote) && !hasNothing(local)) {
        // A library from before this account existed here — carry it over.
        await uploadLibrary(local).catch(() => undefined);
        if (!alive || revision !== mutationRevision.current) return;
        const lifted = await fetchLibrary().catch(() => null);
        if (!alive || revision !== mutationRevision.current) return;
        setState(lifted ? fromServer(lifted) : local);
        return;
      }

      setState(remote);
    })();

    return () => {
      alive = false;
    };
  }, [userId, cached, setState]);

  // Persist once the correct account's library is in memory.
  useEffect(() => {
    if (!userId || snapshot.owner !== userId) return;
    try {
      setItem(storageKey(userId), JSON.stringify(snapshot.library));
    } catch {
      /* storage can be unavailable */
    }
  }, [snapshot, userId]);

  // Match the web client's cross-device library sync. Also reconcile after a
  // reconnect, since server pushes can be missed while the phone is offline.
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    let revision = 0;
    const reload = () => {
      clearTimeout(timer);
      const request = ++revision;
      timer = setTimeout(() => {
        const mutation = mutationRevision.current;
        void fetchLibrary()
          .then((server) => {
            if (
              alive &&
              request === revision &&
              mutation === mutationRevision.current &&
              loadedFor.current === userId
            ) {
              setState(fromServer(server));
            }
          })
          .catch(() => undefined);
      }, 400);
    };
    const off = onCommunityEvent("library:changed", reload);
    const offStatus = onCommunityStatus((connected) => {
      if (connected) reload();
    });
    return () => {
      alive = false;
      off();
      offStatus();
      clearTimeout(timer);
    };
  }, [userId, setState]);

  /**
   * Changes the library at once, then writes it to the account; a write that
   * fails leaves the library exactly as it was and says so.
   */
  const commit = useCallback(
    (updater: (previous: LibraryState) => LibraryState, save: () => Promise<unknown>) => {
      /* Nobody's library to change: a trial visitor is stopped here rather than
         at the API, so no write is staged and no 401 ever reaches the toast. */
      if (!user) return;
      const before = latest.current;
      const revision = ++mutationRevision.current;
      setState((previous) => updater(previous));
      void save().catch((error: unknown) => {
        if (accountRef.current !== user.id) return;
        if (revision === mutationRevision.current) setState(before);
        toast({
          title: error instanceof Error ? error.message : "Could not reach your account.",
          description: "The change was not saved.",
          variant: "error",
        });
      });
    },
    [toast, user, setState]
  );

  const likedIds = useMemo(() => new Set(state.liked.map((song) => song.id)), [state.liked]);
  const isLiked = useCallback((song: Song) => likedIds.has(song.id), [likedIds]);

  const toggleLike = useCallback(
    (song: Song) => {
      if (!requireAuth("like")) return;
      const nowLiked = !likedIds.has(song.id);
      record(nowLiked ? "like" : "unlike", song);
      commit(
        (previous) => {
          const exists = previous.liked.some((entry) => entry.id === song.id);
          return {
            ...previous,
            liked: exists
              ? previous.liked.filter((entry) => entry.id !== song.id)
              : [song, ...previous.liked],
          };
        },
        () => (nowLiked ? saveLikes([song]) : dropLike(song.id))
      );
      if (nowLiked) success("Added to Liked songs", song.title);
      else toast({ title: "Removed from Liked songs", description: song.title });
    },
    [commit, record, requireAuth, likedIds, success, toast]
  );

  const createPlaylist = useCallback(
    (rawName: string): string | null => {
      if (!requireAuth("playlist")) return null;
      const name = rawName.trim().slice(0, MAX_NAME);
      if (!name) {
        setNameError("Give the playlist a name.");
        return null;
      }
      if (state.playlists.length >= MAX_PLAYLISTS) {
        setNameError("That is enough playlists for now.");
        return null;
      }
      if (state.playlists.some((playlist) => playlist.name.toLowerCase() === name.toLowerCase())) {
        setNameError("You already have a playlist with that name.");
        return null;
      }
      const playlist: Playlist = { id: newId(), name, songs: [], createdAt: Date.now() };
      commit(
        (previous) => ({ ...previous, playlists: [playlist, ...previous.playlists] }),
        () => createServerPlaylist(playlist.id, name)
      );
      setNameError(null);
      setNewName("");
      success("Playlist created", name);
      return playlist.id;
    },
    [commit, requireAuth, state.playlists, success]
  );

  const addToPlaylist = useCallback(
    (playlistId: string, song: Song) => {
      if (!requireAuth("playlist")) return;
      const target = state.playlists.find((playlist) => playlist.id === playlistId);
      if (!target) return;
      const already = target.songs.some((entry) => entry.id === song.id);
      if (already) {
        toast({ title: "Already in that playlist", description: song.title });
        return;
      }
      record("playlist_add", song);
      commit(
        (previous) => ({
          ...previous,
          playlists: previous.playlists.map((playlist) =>
            playlist.id === playlistId && !playlist.songs.some((entry) => entry.id === song.id)
              ? { ...playlist, songs: [...playlist.songs, song] }
              : playlist
          ),
        }),
        () => savePlaylistSongs(playlistId, [song])
      );
      success("Added to playlist", song.title);
    },
    [commit, record, requireAuth, state.playlists, success, toast]
  );

  const removeFromPlaylist = useCallback(
    (playlistId: string, songId: string) => {
      commit(
        (previous) => ({
          ...previous,
          playlists: previous.playlists.map((playlist) =>
            playlist.id === playlistId
              ? { ...playlist, songs: playlist.songs.filter((song) => song.id !== songId) }
              : playlist
          ),
        }),
        () => dropPlaylistSong(playlistId, songId)
      );
    },
    [commit]
  );

  const deletePlaylist = useCallback(
    (id: string) => {
      commit(
        (previous) => ({
          ...previous,
          playlists: previous.playlists.filter((playlist) => playlist.id !== id),
        }),
        () => deleteServerPlaylist(id)
      );
      toast({ title: "Playlist deleted" });
    },
    [commit, toast]
  );

  const playLiked = useCallback(() => {
    if (!requireAuth("tab")) return;
    if (!state.liked.length) {
      toast({ title: "Nothing liked yet", description: "Tap the heart on any song." });
      return;
    }
    startQueue(state.liked, "Liked songs", 0);
  }, [requireAuth, state.liked, startQueue, toast]);

  const playPlaylist = useCallback(
    (id: string) => {
      if (!requireAuth("tab")) return;
      const playlist = state.playlists.find((entry) => entry.id === id);
      if (!playlist?.songs.length) {
        toast({ title: "This playlist is empty", description: "Add a song with the + button." });
        return;
      }
      startQueue(playlist.songs, playlist.name, 0);
    },
    [requireAuth, state.playlists, startQueue, toast]
  );

  const openPicker = useCallback(
    (song: Song) => {
      if (!requireAuth("playlist")) return;
      setPickerSong(song);
      setNameError(null);
      setNewName("");
    },
    [requireAuth]
  );

  const closePicker = useCallback(() => setPickerSong(null), []);

  const submitPlaylist = () => {
    if (!pickerSong) return;
    const name = newName.trim().slice(0, MAX_NAME);
    if (!name) {
      setNameError("Give the playlist a name.");
      return;
    }
    if (state.playlists.some((playlist) => playlist.name.toLowerCase() === name.toLowerCase())) {
      setNameError("You already have a playlist with that name.");
      return;
    }
    if (state.playlists.length >= MAX_PLAYLISTS) {
      setNameError("That is enough playlists for now.");
      return;
    }

    // Create the playlist and drop the song in with one state change.
    const playlist: Playlist = {
      id: newId(),
      name,
      songs: [pickerSong],
      createdAt: Date.now(),
    };
    commit(
      (previous) => ({ ...previous, playlists: [playlist, ...previous.playlists] }),
      async () => {
        await createServerPlaylist(playlist.id, name);
        await savePlaylistSongs(playlist.id, [pickerSong]);
      }
    );
    success("Playlist created", `${name} · ${pickerSong.title}`);
    setNewName("");
    setNameError(null);
    setPickerSong(null);
  };

  const value = useMemo<LibraryContextValue>(
    () => ({
      loading,
      liked: state.liked,
      playlists: state.playlists,
      isLiked,
      toggleLike,
      createPlaylist,
      addToPlaylist,
      removeFromPlaylist,
      deletePlaylist,
      playLiked,
      playPlaylist,
      openPicker,
      closePicker,
    }),
    [
      loading,
      state.liked,
      state.playlists,
      isLiked,
      toggleLike,
      createPlaylist,
      addToPlaylist,
      removeFromPlaylist,
      deletePlaylist,
      playLiked,
      playPlaylist,
      openPicker,
      closePicker,
    ]
  );

  return (
    <LibraryContext.Provider value={value}>
      {children}

      {pickerSong ? (
        /* The web drew its own fixed-overlay dialog here; native gets the same
           content through the shared Modal (title, subtitle, dismiss). */
        <Modal
          open
          onClose={closePicker}
          title="Add to playlist"
          description={`${pickerSong.title} · ${pickerSong.artist}`}
          size="sm"
        >
          <View className="flex-col">
            <ScrollView className="max-h-56">
              {state.playlists.map((playlist) => {
                const has = playlist.songs.some((song) => song.id === pickerSong.id);
                return (
                  <Pressable
                    key={playlist.id}
                    disabled={has}
                    onPress={() => {
                      addToPlaylist(playlist.id, pickerSong);
                      setPickerSong(null);
                    }}
                    className={cn(
                      "flex-row items-center gap-2 rounded-lg px-2 py-2",
                      has ? "opacity-50" : "active:bg-surface-secondary"
                    )}
                  >
                    <Icon name="list" className="size-4 shrink-0 text-muted" />
                    <Text
                      numberOfLines={1}
                      className={cn(
                        "min-w-0 flex-1 text-xs",
                        has ? "text-faint-foreground" : "text-foreground"
                      )}
                    >
                      {playlist.name}
                    </Text>
                    <Text className="shrink-0 text-[10px] text-faint-foreground">
                      {has ? "Added" : `${playlist.songs.length}`}
                    </Text>
                  </Pressable>
                );
              })}
              {!state.playlists.length ? (
                <Text className="px-2 py-3 text-xs text-muted">
                  No playlists yet — name one below and it is created with this song.
                </Text>
              ) : null}
            </ScrollView>

            <View className="mt-3 flex-row items-center gap-1.5">
              <TextInput
                value={newName}
                onChangeText={(next) => {
                  setNewName(next);
                  setNameError(null);
                }}
                maxLength={MAX_NAME}
                placeholder="New playlist name"
                accessibilityLabel="New playlist name"
                className="h-9 min-w-0 flex-1 rounded-lg border border-separator bg-surface-secondary/50 px-2.5 text-foreground text-xs"
              />
              <Button variant="primary" onPress={submitPlaylist}>
                Create
              </Button>
            </View>
            {nameError ? (
              <Text className="pt-1.5 text-[11px] text-danger-soft-foreground">{nameError}</Text>
            ) : null}
          </View>
        </Modal>
      ) : null}
    </LibraryContext.Provider>
  );
}

export function useLibrary(): LibraryContextValue {
  const context = useContext(LibraryContext);
  if (!context) throw new Error("useLibrary must be used inside LibraryProvider");
  return context;
}
