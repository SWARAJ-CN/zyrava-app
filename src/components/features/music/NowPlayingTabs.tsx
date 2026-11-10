import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { LyricsPanel } from "@/components/features/music/LyricsPanel";
import { RelatedSongs } from "@/components/features/music/RelatedSongs";
import type { Song } from "@/lib/saavn";
import { getItem, setItem } from "@/lib/store";
import { cn } from "@/lib/cn";

export type NowPlayingTab = "lyrics" | "related";

const TAB_KEY = "zyrava:now-playing-tab";

/**
 * Lyrics lead, because that is what someone looking at the card while a song
 * plays came for; the radio is one tap away and the choice is remembered.
 *
 * localStorage → the store shim (AsyncStorage-backed, synchronous reads from
 * the hydrated cache, same key and same values).
 */
function readTab(): NowPlayingTab {
  try {
    return getItem(TAB_KEY) === "related" ? "related" : "lyrics";
  } catch {
    return "lyrics";
  }
}

/**
 * Held above the switch because the card needs the choice too: the artwork
 * gives up its square in lyrics mode so the words have a window worth reading.
 */
export function useNowPlayingTab(): [NowPlayingTab, (next: NowPlayingTab) => void] {
  const [tab, setTab] = useState<NowPlayingTab>(readTab);

  const choose = useCallback((next: NowPlayingTab) => {
    setTab(next);
    try {
      setItem(TAB_KEY, next);
    } catch {
      /* Quota or a cold store: the tab still switches for this session. */
    }
  }, []);

  return [tab, choose];
}

/**
 * The two things the now playing card shows about the current track.
 *
 * A Fragment, not a wrapper: the card's own column is what gives either panel
 * a bounded height, and inserting a box here would take `flex-1` away from the
 * panel and let sixty lyric rows push the playback buttons off the card.
 */
export function NowPlayingTabs({
  song,
  tab,
  onTab,
}: {
  song: Song;
  tab: NowPlayingTab;
  onTab: (next: NowPlayingTab) => void;
}) {
  return (
    <>
      <View className="mt-5 flex-row flex-none gap-1 rounded-xl border border-separator bg-surface p-1">
        {(["lyrics", "related"] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === option }}
            onPress={() => onTab(option)}
            className={cn(
              "flex h-8 flex-1 items-center justify-center rounded-lg",
              tab === option ? "bg-accent" : ""
            )}
          >
            <Text
              className={cn(
                "text-[11px] font-semibold",
                tab === option ? "text-accent-foreground" : "text-muted"
              )}
            >
              {option === "lyrics" ? "Lyrics" : "Related songs"}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === "lyrics" ? <LyricsPanel song={song} /> : <RelatedSongs song={song} />}
    </>
  );
}
