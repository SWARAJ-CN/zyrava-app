import { useEffect, useState } from "react";
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useThemeColor } from "heroui-native";
import { Image } from "expo-image";
import { SearchInput } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/Feedback";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { cn } from "@/lib/cn";
import { searchSongMatches, searchSongs, type Song } from "@/lib/saavn";
import { isStrongSongMatch, recordingVersion } from "@/lib/search-ranking";

interface SearchWithSuggestionsProps {
  value: string;
  onChange: (value: string) => void;
  onPick: (song: Song) => void;
  onCommit?: (value: string) => void;
  className?: string;
}

// Session-only history: no account or device storage of someone's searches.
let recentQueries: string[] = [];
type Results = { query: string; songs: Song[]; status: "ready" | "loading" | "error" };

export function SearchWithSuggestions({
  value,
  onChange,
  onPick,
  onCommit,
  className,
}: SearchWithSuggestionsProps) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState(recentQueries);
  const [results, setResults] = useState<Results>({ query: "", songs: [], status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const reducedMotion = useReduceMotion();
  const backgroundColor = useThemeColor("background");
  const query = value.trim();
  const searching = query.length >= 2;
  const tooShort = query.length === 1;
  const current = results.query === query;
  const loading = !current || results.status === "loading";
  const failed = current && results.status === "error";
  const songs = current && !failed && !tooShort ? results.songs : [];

  useEffect(() => {
    if (!open || tooShort) return;
    let alive = true;
    const timer = setTimeout(
      () => {
        setResults({ query, songs: [], status: "loading" });
        const request = searching ? searchSongMatches(query, 6) : searchSongs("trending songs", 6);
        request
          .then((data) => {
            if (alive) setResults({ query, songs: data.songs, status: "ready" });
          })
          .catch(() => {
            if (alive) setResults({ query, songs: [], status: "error" });
          });
      },
      searching ? 260 : 0
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, query, searching, tooShort, attempt]);

  const close = () => {
    Keyboard.dismiss();
    setOpen(false);
  };
  const remember = () => {
    if (!searching) return;
    recentQueries = [
      query,
      ...recentQueries.filter((item) => item.toLowerCase() !== query.toLowerCase()),
    ].slice(0, 5);
    setRecent(recentQueries);
  };
  const commit = () => {
    if (!searching) return;
    remember();
    close();
    onCommit?.(query);
  };

  return (
    <View className={cn("w-full", className)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={query ? `Search music: ${query}` : "Search songs, artists or albums"}
        onPress={() => setOpen(true)}
        className="min-h-12 flex-row items-center gap-3 bg-surface-secondary px-4 active:opacity-70"
      >
        <Icon name="search" size={19} className="text-muted" />
        <Text
          numberOfLines={1}
          className={cn("flex-1 text-sm", query ? "text-foreground" : "text-muted")}
        >
          {query || "Search songs, artists or albums"}
        </Text>
      </Pressable>
      <Modal
        visible={open}
        animationType={reducedMotion ? "none" : "fade"}
        onRequestClose={close}
        presentationStyle="fullScreen"
      >
        <GestureHandlerRootView style={{ flex: 1, backgroundColor }}>
          <SafeAreaView style={{ flex: 1, backgroundColor }}>
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
              <View className="flex-row items-center justify-between px-5 pt-2 pb-3">
                <Text accessibilityRole="header" className="text-2xl font-semibold text-foreground">
                  Find your music
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close search"
                  onPress={close}
                  className="size-12 items-center justify-center"
                >
                  <Icon name="x" size={22} />
                </Pressable>
              </View>
              <View className="px-5 pb-4">
                {open ? (
                  <SearchInput
                    value={value}
                    onChange={onChange}
                    onSubmit={commit}
                    autoFocus
                    placeholder="Song title, artist, or title by artist"
                  />
                ) : null}
              </View>
              <FlatList
                data={songs}
                keyExtractor={(song) => song.id}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
                ListHeaderComponent={
                  <View>
                    {!query && recent.length ? (
                      <View className="mb-6">
                        <View className="flex-row items-center justify-between">
                          <Text className="text-sm font-semibold text-foreground">
                            Recent searches
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => {
                              recentQueries = [];
                              setRecent([]);
                            }}
                            className="min-h-11 justify-center px-2"
                          >
                            <Text className="text-xs text-muted">Clear</Text>
                          </Pressable>
                        </View>
                        {recent.map((item) => (
                          <Pressable
                            key={item}
                            onPress={() => onChange(item)}
                            accessibilityRole="button"
                            accessibilityLabel={`Search ${item}`}
                            className="min-h-11 flex-row items-center gap-3"
                          >
                            <Icon name="search" size={15} className="text-muted" />
                            <Text numberOfLines={1} className="flex-1 text-sm text-foreground">
                              {item}
                            </Text>
                            <Icon name="chevron-right" size={15} className="text-muted" />
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    <Text className="mb-2 text-sm font-semibold text-foreground">
                      {searching ? "Matching songs" : "Discover"}
                    </Text>
                    {!searching ? (
                      <Text className="mb-4 text-xs text-muted">
                        {tooShort
                          ? "Type at least two characters to search."
                          : "Know the artist? Try “song title by artist” for a closer match."}
                      </Text>
                    ) : null}
                  </View>
                }
                ListEmptyComponent={
                  tooShort ? undefined : failed ? (
                    <View className="gap-3 py-8">
                      <Text className="text-sm font-medium text-foreground">
                        Search couldn’t load
                      </Text>
                      <Text className="text-sm text-muted">
                        Check your connection and try again.
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setAttempt((value) => value + 1)}
                        className="min-h-11 items-center justify-center bg-accent-soft px-4 self-start"
                      >
                        <Text className="text-sm font-semibold text-accent-soft-foreground">
                          Retry search
                        </Text>
                      </Pressable>
                    </View>
                  ) : loading ? (
                    <View
                      accessibilityLabel="Searching for songs"
                      accessibilityRole="progressbar"
                      className="gap-5 py-3"
                    >
                      {[0, 1, 2].map((key) => (
                        <View key={key} className="flex-row items-center gap-3">
                          <Skeleton className="size-14 rounded-none" />
                          <View className="flex-1 gap-2">
                            <Skeleton className="h-4 w-3/4" />
                            <Skeleton className="h-3 w-1/2" />
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <View className="gap-2 py-8">
                      <Text className="text-base font-medium text-foreground">No songs found</Text>
                      <Text className="text-sm text-muted">
                        Try the title on its own or check the artist’s spelling.
                      </Text>
                    </View>
                  )
                }
                renderItem={({ item: song, index }) => {
                  const version = recordingVersion(song.title);
                  const best = searching && index === 0 && isStrongSongMatch(song, query);
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Play ${song.title} by ${song.artist}, ${song.album}`}
                      onPress={() => {
                        remember();
                        close();
                        onPick(song);
                      }}
                      className="min-h-20 flex-row items-center gap-3 py-3 active:opacity-60"
                    >
                      <View className="size-14 items-center justify-center bg-surface-secondary">
                        {song.image ? (
                          <Image
                            source={{ uri: song.image }}
                            style={{ width: 56, height: 56 }}
                            contentFit="cover"
                          />
                        ) : (
                          <Icon name="music" size={22} />
                        )}
                      </View>
                      <View className="min-w-0 flex-1 gap-1">
                        {best ? (
                          <Text className="text-[10px] font-semibold uppercase tracking-wider text-accent">
                            Best match
                          </Text>
                        ) : null}
                        <Text numberOfLines={1} className="text-base font-semibold text-foreground">
                          {song.title}
                        </Text>
                        <Text numberOfLines={1} className="text-sm text-muted">
                          {song.artist}
                        </Text>
                        {song.album ? (
                          <Text numberOfLines={1} className="text-xs text-muted">
                            {song.album}
                          </Text>
                        ) : null}
                        {version ? (
                          <Text className="text-[10px] capitalize text-muted">{version}</Text>
                        ) : null}
                      </View>
                      <Icon name="play" size={18} className="text-foreground" />
                    </Pressable>
                  );
                }}
              />
              {searching ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={commit}
                  className="mx-5 mb-3 min-h-12 flex-row items-center justify-between gap-3 bg-accent-soft px-4"
                >
                  <Text
                    numberOfLines={1}
                    className="flex-1 text-sm font-semibold text-accent-soft-foreground"
                  >
                    See all results for “{query}”
                  </Text>
                  <Icon name="chevron-right" size={18} className="text-accent-soft-foreground" />
                </Pressable>
              ) : null}
            </KeyboardAvoidingView>
          </SafeAreaView>
        </GestureHandlerRootView>
      </Modal>
    </View>
  );
}
