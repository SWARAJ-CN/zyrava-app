import { useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { SearchInput } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { searchSongs } from "@/lib/saavn";
import type { Song } from "@/lib/saavn";

interface SearchWithSuggestionsProps {
  value: string;
  onChange: (value: string) => void;
  onPick: (song: Song) => void;
  /** Enter with a phrase: the page scrolls the list into view. */
  onCommit?: (value: string) => void;
  className?: string;
}

/**
 * The home search box plus its instant suggestion tray. Empty query shows
 * what is trending; typing shows matching songs. Picking one starts it.
 *
 * Platform swaps:
 *  • The tray fetch (`/api/music/search?…&limit=6`) becomes a DIRECT call to
 *    the ported saavn client — RN has no CORS and no Next route handlers.
 *  • The 260 ms debounce and the "trending songs" fallback stay verbatim.
 *  • Document pointerdown → a transparent full-screen backdrop behind the
 *    tray; a tap outside the search block closes it.
 *  • Escape handling is dropped (no keyboard on a phone; the tray closes on
 *    pick or backdrop tap). The Enter-to-commit path stays wired through the
 *    keyboard-free "Press Enter…" hint row, whose handler the home screen
 *    reaches with its own submit.
 */
export function SearchWithSuggestions({
  value,
  onChange,
  onPick,
  onCommit,
  className,
}: SearchWithSuggestionsProps) {
  const [open, setOpen] = useState(false);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<View | null>(null);
  const query = value.trim();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      const search = query.length >= 2 ? query : "trending songs";
      // Direct upstream search instead of the Next route: same 6-limit,
      // same keep-the-previous-tray rule on failure.
      searchSongs(search, 6)
        .then((data) => {
          if (!controller.signal.aborted) setSongs(data.songs.slice(0, 6));
        })
        .catch(() => {
          /* keep the previous tray instead of flashing empty */
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 260);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  /* Enter-to-commit (the web's root onKeyDown) has no native equivalent here:
     the ported Controls.SearchInput owns the text field, so the home screen
     passes its own submit into `onCommit` when its keyboard fires a search
     action. Escape-to-close is dropped — the backdrop tap covers dismissal. */
  const commit = () => {
    if (query.length >= 2) {
      setOpen(false);
      onCommit?.(query);
    }
  };

  return (
    <>
      {open ? (
        // Outside-tap catcher — sits under the tray, over the page.
        <Pressable
          accessibilityLabel="Close suggestions"
          onPress={() => setOpen(false)}
          className="fixed inset-0 z-40"
        />
      ) : null}
      <View ref={rootRef as never} className={cn("relative", className)}>
        {/* The web opened the tray on input focus; a press on the field is the
            touch equivalent (typing also opens it through onChange). */}
        <Pressable onPress={() => setOpen(true)}>
          <SearchInput
            value={value}
            onChange={(next) => {
              onChange(next);
              setOpen(true);
            }}
            placeholder="Search songs, artists or albums…"
            className="w-full"
          />
        </Pressable>

        {open ? (
          <View className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-separator bg-surface shadow-pop">
            <Text className="px-3.5 pb-1.5 pt-2.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-faint-foreground">
              {query.length >= 2 ? "Songs" : "Trending near you"}
            </Text>
            <ScrollView className="max-h-80" nestedScrollEnabled>
              {loading && !songs.length ? (
                <Text className="px-3.5 py-4 text-xs text-muted">Searching…</Text>
              ) : null}
              {!loading && !songs.length ? (
                <Text className="px-3.5 py-4 text-xs text-muted">
                  {query.length >= 2
                    ? "No matches yet — keep typing."
                    : "Nothing trending right now."}
                </Text>
              ) : null}
              {songs.map((song) => (
                <Pressable
                  key={song.id}
                  accessibilityRole="button"
                  onPress={() => {
                    onPick(song);
                    setOpen(false);
                  }}
                  className="flex-row items-center gap-3 px-3 py-2 text-left transition-colors active:bg-surface-secondary"
                >
                  <View className="relative size-9 flex-none overflow-hidden rounded-md bg-surface-muted">
                    {song.image ? (
                      <Image
                        source={{ uri: song.image }}
                        style={{ width: "100%", height: "100%" }}
                        resizeMode="cover"
                      />
                    ) : (
                      <Icon name="music" className="m-auto size-4 text-faint-foreground" />
                    )}
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text
                      numberOfLines={1}
                      className="block truncate text-[12px] font-semibold text-foreground"
                    >
                      {song.title}
                    </Text>
                    <Text numberOfLines={1} className="block truncate text-[10px] text-muted">
                      {song.artist}
                    </Text>
                  </View>
                  <Icon
                    name="play"
                    className="size-3.5 flex-none fill-current text-faint-foreground"
                  />
                </Pressable>
              ))}
            </ScrollView>
            {query.length >= 2 ? (
              // The Enter affordance doubles as a tap target on touch.
              <Pressable
                accessibilityRole="button"
                onPress={commit}
                className="border-t border-separator px-3.5 py-2 active:bg-surface-secondary"
              >
                <Text className="text-[10px] text-faint-foreground">
                  Press Enter to search the full catalogue
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </>
  );
}
