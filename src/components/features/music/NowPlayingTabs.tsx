import { useCustomization } from "@/components/providers/CustomizationProvider";
import { useCallback, useState } from "react";
import { Tabs } from "heroui-native";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { LyricsPanel } from "@/components/features/music/LyricsPanel";
import { NowPlayingEqualizer } from "./NowPlayingEqualizer";
import { RelatedSongs } from "@/components/features/music/RelatedSongs";
import type { Song } from "@/lib/saavn";
import { getItem, setItem } from "@/lib/store";

export type NowPlayingTab = "lyrics" | "related" | "eq";

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
    const saved = getItem(TAB_KEY);
    return saved === "related" || saved === "eq" ? saved : "lyrics";
  } catch {
    return "lyrics";
  }
}

/**
 * Held above the switch so the card can give synced lyrics a bounded viewport
 * while preserving the square artwork in either tab.
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
 * Lyrics, radio, and shared audio controls inside the now playing card.
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
  const { personal } = useCustomization();
  const visibleTab = personal && tab === "eq" ? "lyrics" : tab;
  const reduced = useReduceMotion();
  return (
    <>
      <Tabs
        value={visibleTab}
        onValueChange={(value) => onTab(value as NowPlayingTab)}
        variant="secondary"
        animation={reduced ? "disable-all" : undefined}
        className="shrink-0 gap-0"
      >
        <Tabs.List className="w-full border-0">
          <Tabs.Indicator />
          {(["lyrics", "related", "eq"] as const)
            .filter((option) => !personal || option !== "eq")
            .map((option) => (
              <Tabs.Trigger key={option} value={option} className="min-h-12 flex-1">
                {({ isSelected }) => (
                  <Tabs.Label
                    className={
                      isSelected ? "text-sm font-semibold text-foreground" : "text-sm text-muted"
                    }
                  >
                    {option === "lyrics" ? "Lyrics" : option === "related" ? "Related" : "EQ"}
                  </Tabs.Label>
                )}
              </Tabs.Trigger>
            ))}
        </Tabs.List>
      </Tabs>

      {visibleTab === "lyrics" ? (
        <LyricsPanel song={song} />
      ) : visibleTab === "related" ? (
        <RelatedSongs song={song} />
      ) : (
        <NowPlayingEqualizer />
      )}
    </>
  );
}
