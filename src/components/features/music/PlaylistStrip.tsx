import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { Icon } from "@/components/ui/icons";
import { searchPlaylists } from "@/lib/saavn";

/**
 * A small row of catalogue playlists matching the current search, shown in
 * the Songs tab. Tapping one opens the Playlists tab with the same query.
 *
 * The `/api/music/playlists` fetch became a direct `searchPlaylists(query, 6)`
 * against the ported saavn client; the rAF-deferred loading tick is dropped
 * (it existed to dodge the web's paint timing — on RN the first frame already
 * shows the skeleton). Horizontal overflow-scroll → a horizontal ScrollView.
 */
export function PlaylistStrip({ query, onOpen }: { query: string; onOpen: () => void }) {
  const [playlists, setPlaylists] = useState<
    Array<{ id: string; title: string; image: string; songCount: number }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    // rAF-deferred reset — the web's own tick (and React's setState-in-effect rule).
    const frame = requestAnimationFrame(() => setLoading(true));

    searchPlaylists(query, 6)
      .then((data) => {
        if (alive) setPlaylists(Array.isArray(data?.playlists) ? data.playlists : []);
      })
      .catch(() => {
        if (alive) setPlaylists([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, [query]);

  if (!loading && !playlists.length) return null;

  return (
    <View className="mt-5">
      <View className="flex-row items-center justify-between gap-3 pb-2.5">
        <Text numberOfLines={1} className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
          Playlists for “{query}”
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onOpen}
          className="transition-colors active:opacity-70"
        >
          <Text className="text-[11px] font-medium text-muted active:text-foreground">See all →</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 12, paddingBottom: 4 }}
      >
        {loading
          ? Array.from({ length: 5 }).map((_, index) => (
              <View key={index} className="w-28 flex-none animate-pulse">
                <View className="aspect-square rounded-lg bg-surface-secondary" />
                <View className="mt-2 h-2.5 w-3/4 rounded bg-surface-secondary" />
              </View>
            ))
          : playlists.map((playlist) => (
              <Pressable
                key={playlist.id}
                accessibilityRole="button"
                onPress={onOpen}
                accessibilityLabel={`Open ${playlist.title}`}
                className="w-28 flex-none"
              >
                <View className="relative aspect-square overflow-hidden rounded-lg border border-separator bg-surface-secondary">
                  {playlist.image ? (
                    <Image
                      source={{ uri: playlist.image }}
                      className="absolute inset-0 size-full"
                      resizeMode="cover"
                    />
                  ) : (
                    <Icon
                      name="list"
                      className="absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 text-faint-foreground"
                    />
                  )}
                  <View className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <Text className="absolute bottom-1.5 left-1.5 rounded bg-black/45 px-1.5 py-0.5 text-[9px] font-semibold text-white/80">
                    {playlist.songCount}
                  </Text>
                </View>
                <Text numberOfLines={1} className="mt-1.5 block truncate text-[11px] font-semibold text-foreground">
                  {playlist.title}
                </Text>
              </Pressable>
            ))}
      </ScrollView>
    </View>
  );
}
