import { useCustomization } from "@/components/providers/CustomizationProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { CustomizationConsole } from "@/components/features/customization/CustomizationConsole";
import { PaymentsHistory } from "@/components/features/customization/PaymentsHistory";
import { PersonalHeader } from "@/components/features/music/PersonalHeader";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  type ScrollViewInstance,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import type { JSX } from "react";

import { Pagination, PageHeader } from "@/components/ui/Controls";
import {
  HomeTabs,
  HomeTabPanel,
  HOME_TABS,
  type HomeTab,
} from "@/components/features/music/HomeTabs";
import { Button } from "@/components/ui/Button";
import { EmptyState, Notice, Skeleton, Spinner } from "@/components/ui/Feedback";
import { Icon } from "@/components/ui/icons";
import { RegionCarousel } from "@/components/features/music/RegionCarousel";
import { songHueSeed } from "@/components/features/music/BeatGlow";
import { BeatWordmark } from "@/components/features/music/BeatWordmark";
import { SearchWithSuggestions } from "@/components/features/music/SearchWithSuggestions";
import { PlaylistsView } from "@/components/features/music/PlaylistsView";
import { LikedView } from "@/components/features/music/LikedView";
import { DownloadsView, OfflineView } from "@/components/features/music/DeviceViews";
import { SaveToDevice } from "@/components/features/music/SongRows";
import { ImportSongsModal } from "@/components/features/music/ImportSongsModal";
import { InstallModal } from "@/components/features/music/InstallModal";
import { Waveform } from "@/components/features/music/Waveform";
import { EqBars } from "@/components/features/music/EqBars";
import { Scrim, SCRIM_STOPS } from "@/components/ui/Scrim";
import { Recommendations } from "@/components/features/music/Recommendations";
import { PlaylistStrip } from "@/components/features/music/PlaylistStrip";
import { VIBES } from "@/components/features/music/filters";
import { REGIONS } from "@/components/features/music/regions";
import { useTaste } from "@/components/providers/TasteProvider";
import { useGuestLock } from "@/components/providers/GuestLockProvider";
import { useMusicPlayer } from "@/components/providers/MusicPlayerProvider";
import { useLibrary } from "@/components/providers/LibraryProvider";
import { useOffline } from "@/components/providers/OfflineProvider";
import { rankSongs } from "@/lib/recommend";
import {
  dedupeSongs,
  searchSongs,
  searchSongMatches,
  songFingerprint,
  type Song,
} from "@/lib/saavn";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ *
 * The web `app/page.tsx`, ported screen-for-screen.
 *
 * Structural changes are platform, not logic:
 *  • the fixed side preview (NowPlayingPanel) and the dock are mobile
 *    routes opened from the player bar / header — see (app)/_layout;
 *  • `?tab=` PWA shortcuts arrive as expo-router params instead of
 *    window.location.search;
 *  • `document.getElementById().scrollIntoView` → measured anchors +
 *    ScrollView.scrollTo;
 *  • `/api/music/search` route-handler calls → searchSongs() direct, with
 *    the route's own over-fetch (×1.7) + slice contract preserved.
 * ------------------------------------------------------------------ */

const PAGE_SIZE = 10;
/** How far into a query the browse feed may open. Every visit draws its own
 *  spot, so the same ten songs never meet you at the door twice. */
const FEED_ROTATION = 12;
/** How far playback may walk through the pages of one search on its own. */
const MAX_CHAIN_PAGES = 12;
/** The carousel re-cuts itself every calendar day, so the feed is never a rerun. */
const DAY_MS = 86_400_000;
let carouselDay = 0;

type ViewMode = "small" | "large" | "list";

const VIEW_OPTIONS = [
  { value: "list", label: "List", icon: <Icon name="list" /> },
  { value: "small", label: "Compact grid", icon: <Icon name="grid" /> },
  { value: "large", label: "Large grid", icon: <Icon name="image" /> },
] as const;

const DEFAULT_VIEW: ViewMode = "list";

/** Grid columns for phone widths: the web's `sm:` steps never apply here. */
const GRID_COLS: Record<Exclude<ViewMode, "list">, number> = {
  small: 3,
  large: 2,
};

interface Library {
  /** The region label|attempt combo this chunk belongs to. */
  termKey: string;
  songs: Song[];
  total: number;
  /** True when a batch produced nothing new — pagination is pointless then. */
  drained: boolean;
}

type PagePayload = { songs?: Song[]; total?: number };
type PageResult = PagePayload | { error: string } | null;

export default function MusicPage(): JSX.Element {
  const { personal } = useCustomization();
  const { user } = useAuth();
  const [input, setInput] = useState("");
  const [term, setTerm] = useState<string>(REGIONS[0].label);
  /** Pages skipped before the feed opens — drawn once per visit. */
  const [feedOffset, setFeedOffset] = useState(() => Math.floor(Math.random() * FEED_ROTATION));
  const [batch, setBatch] = useState(0);
  /** Bumped by "Retry" to force a refetch without changing the query. */
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<ViewMode>(DEFAULT_VIEW);
  const [homeTab, setHomeTab] = useState<HomeTab>("songs");
  const { isGuest, requireAuth } = useGuestLock();

  const params = useLocalSearchParams<{ tab?: string; section?: string; visit?: string }>();

  /* The launcher shortcut (home-screen widget / deep link) lands on
     /?tab=liked and friends — the chosen panel is honoured once, on arrival.
     A trial visitor is steered to the shelves instead of straight into them. */
  useEffect(() => {
    const asked = params.tab;
    if (!HOME_TABS.some((entry) => entry.value === asked)) return;
    const wanted = asked as HomeTab;
    if (isGuest && wanted !== "songs") return;
    if (personal && (wanted === "customize" || wanted === "payments")) return;
    const timer = setTimeout(() => setHomeTab(wanted), 0);
    return () => clearTimeout(timer);
  }, [isGuest, params.tab, params.visit, personal]);
  const [importOpen, setImportOpen] = useState(false);

  /* Multi-check filters — languages and "why am I listening" vibes. */
  const [selectedLangs, setSelectedLangs] = useState<string[]>([]);
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);

  /** Cover images for the region cards, fetched once on mount. */
  const [covers, setCovers] = useState<Record<string, string>>({});

  const [library, setLibrary] = useState<Library>({
    termKey: "",
    songs: [],
    total: 0,
    drained: false,
  });
  const [error, setError] = useState<string | null>(null);

  // Playback state is app-wide — provided by the shell's MusicPlayerProvider
  // so the queue keeps playing across tab switches and screens.
  const {
    queue,
    index,
    playing,
    loading: trackLoading,
    queueLabel,
    visualizerReady,
    getAnalyser,
    startQueue,
    appendQueue,
    setQueueEnd,
    repeat,
    setMobileNavOpen,
    shuffle,
    toggleShuffle,
  } = useMusicPlayer();

  const { isLiked, toggleLike, openPicker } = useLibrary();
  const { locals } = useOffline();
  const { record: recordSearch } = useTaste();
  const lastSearchRef = useRef<string | null>(null);

  /* ── Scroll plumbing (replaces scrollIntoView) ─────────────────────── */
  const scrollRef = useRef<ScrollViewInstance>(null);
  const anchors = useRef<Record<string, number>>({});
  const contentOffset = useRef(0);
  const pendingAnchor = useRef<string | null>(null);
  const sectionVisit = useRef<string | null>(null);
  const scrollToAnchor = useCallback((key: string) => {
    if (!scrollRef.current) {
      pendingAnchor.current = key;
      return;
    }
    if (key === "top") {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    const y = anchors.current[key];
    if (typeof y === "number")
      scrollRef.current?.scrollTo({
        y: Math.max(0, y + contentOffset.current - 8),
        animated: true,
      });
    else pendingAnchor.current = key;
  }, []);
  const anchor = useCallback(
    (key: string) => (event: { nativeEvent: { layout: { y: number } } }) => {
      anchors.current[key] = event.nativeEvent.layout.y;
      if (pendingAnchor.current === key) {
        pendingAnchor.current = null;
        scrollToAnchor(key);
      }
    },
    [scrollToAnchor]
  );
  useEffect(() => {
    if (!params.section || homeTab !== "songs") return;
    const visit = `${params.visit ?? ""}:${params.section}`;
    if (sectionVisit.current === visit) return;
    const frame = requestAnimationFrame(() => {
      sectionVisit.current = visit;
      scrollToAnchor(params.section!);
    });
    return () => cancelAnimationFrame(frame);
  }, [params.section, params.visit, homeTab, scrollToAnchor]);

  useEffect(() => {
    if (homeTab !== "songs" || !pendingAnchor.current) return;
    const frame = requestAnimationFrame(() => {
      const key = pendingAnchor.current;
      pendingAnchor.current = null;
      if (key) scrollToAnchor(key);
    });
    return () => cancelAnimationFrame(frame);
  }, [homeTab, scrollToAnchor]);

  /** First look at the Offline tab is the import pitch. Only the song feed is
   *  a guest's to browse; the shelves that hold a listener's own things are not. */
  const openTab = useCallback(
    (value: HomeTab) => {
      if (value !== "songs" && !requireAuth("tab")) return;
      if (personal && (value === "customize" || value === "payments")) return;
      setHomeTab(value);
      if (value === "offline" && !locals.length) setImportOpen(true);
    },
    [requireAuth, locals.length, personal]
  );

  const baseRegion = useMemo(
    () => REGIONS.find((candidate) => candidate.label === term) ?? REGIONS[0],
    [term]
  );

  /** A region chip was picked (or nothing was typed) — otherwise this is a
   *  free-text search, and the typed phrase becomes the query itself. */
  const isRegion = useMemo(() => REGIONS.some((candidate) => candidate.label === term), [term]);
  const freeText = isRegion ? "" : term.trim();
  /** Catalogue playlist query: the typed phrase, or the region's own opener. */
  const playlistQuery = freeText || baseRegion.queries[0] || "top playlists";
  /** Tracks per numbered page: ten songs, then next. */
  const pageSize = PAGE_SIZE;
  /** The browse feed opens on a fresh spot each visit; a typed search starts
   *  at its own first page, where the user expects it. */
  const firstPage = freeText ? 1 : feedOffset + 1;

  /** The regions the filter bar currently counts — selected, or the active one. */
  const activeRegions = useMemo(
    () =>
      selectedLangs.length
        ? REGIONS.filter((candidate) => selectedLangs.includes(candidate.label))
        : [baseRegion],
    [selectedLangs, baseRegion]
  );
  /** The checked vibes, resolved to full definitions (preserving chip order). */
  const activeVibes = useMemo(
    () => VIBES.filter((vibe) => selectedVibes.includes(vibe.value)),
    [selectedVibes]
  );
  /** Signature of the whole filter selection — any change is a new library. */
  const filterKey = `${selectedLangs.join(">")}|${selectedVibes.join(">")}`;

  const requestKey = `${term}|${filterKey}|${batch}|${attempt}|${feedOffset}`;
  const termKey = `${term}|${filterKey}|${attempt}|${feedOffset}`;
  const [loadedKey, setLoadedKey] = useState("");
  const fetching = loadedKey !== requestKey;

  const requestRef = useRef(0);

  /**
   * Page chaining: playback started from this list walks the numbered pages
   * 1 → 2 → 3 … instead of looping the ten songs it began with.
   */
  const chain = useRef<{
    key: string;
    page: number;
    firstId: string;
    turnToken: string;
    empties: number;
  } | null>(null);

  const activeId = queue[index]?.id ?? null;

  /** Toggles a language chip — any change resets the page counter. */
  const toggleLang = (label: string) => {
    setSelectedLangs((prev) =>
      prev.includes(label) ? prev.filter((value) => value !== label) : [...prev, label]
    );
    setBatch(0);
  };

  /** Toggles a vibe chip — same reset, new query shape. */
  const toggleVibe = (value: string) => {
    setSelectedVibes((prev) =>
      prev.includes(value) ? prev.filter((entry) => entry !== value) : [...prev, value]
    );
    setBatch(0);
  };

  /** Clears every filter chip in one tap. */
  const clearFilters = () => {
    setSelectedLangs([]);
    setSelectedVibes([]);
    setBatch(0);
  };

  /** Opens a region below and brings the library into view. */
  const openRegion = (label: string) => {
    setInput("");
    setTerm(label);
    setBatch(0);
    setSelectedLangs([label]);
    if (term !== label) setAttempt((value) => value + 1);
    requestAnimationFrame(() => scrollToAnchor("region-library"));
  };

  /** A page turn replaces the ten visible songs, then rests on the list. */
  const openPage = (value: number) => {
    if (value > 0 && !requireAuth("paging")) return;
    setBatch(value);
    requestAnimationFrame(() => scrollToAnchor("library-list"));
  };

  /**
   * Carousel play — starts the region's catalogue immediately.
   */
  const playRegionNow = async (label: string): Promise<void> => {
    const region = REGIONS.find((candidate) => candidate.label === label);
    if (!region) return;
    setTerm(label);
    setBatch(0);
    try {
      // A day-shifted page: pressing play on the carousel opens today's set,
      // not yesterday's opening track.
      const result = await searchSongs(region.queries[0], PAGE_SIZE, 1 + (carouselDay % 9));
      const fresh = (result.songs ?? []).slice();
      if (fresh.length) {
        // The carousel's own first page is not the ranked list below, so it
        // does not join the chain.
        chain.current = null;
        startQueue(fresh, label, 0);
        requestAnimationFrame(() => scrollToAnchor("region-library"));
      }
    } catch {
      // The catalogue fetch failing quietly keeps the app usable — the region
      // can still be opened manually.
    }
  };

  // Debounced search — clearing the box returns to the region you were
  // browsing instead of snapping back to the first region.
  useEffect(() => {
    const value = input.trim();
    const timer = setTimeout(() => {
      if (value.length >= 2) {
        setTerm(value);
        setBatch(0);
        // Only the committed phrase is a signal, never the keystrokes that led to it.
        if (value !== lastSearchRef.current) {
          lastSearchRef.current = value;
          recordSearch("search", undefined, { q: value });
        }
      } else if (!value) {
        setTerm((current) =>
          REGIONS.some((candidate) => candidate.label === current) ? current : REGIONS[0].label
        );
        setBatch(0);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [input, recordSearch]);

  /* Region card covers: one quiet search per region, day-rotated. */
  useEffect(() => {
    let cancelled = false;
    carouselDay = Math.floor(Date.now() / DAY_MS);
    for (const candidate of REGIONS) {
      const regionIndex = REGIONS.indexOf(candidate);
      searchSongs(candidate.queries[0], 12, 1 + ((carouselDay + regionIndex * 5) % 12))
        .then((payload) => {
          if (cancelled) return;
          const songs = payload?.songs ?? [];
          const pick = songs.length ? songs[(carouselDay + regionIndex) % songs.length] : null;
          const image = pick?.imageLarge ?? pick?.image;
          if (image) {
            setCovers((prev) => ({ ...prev, [candidate.label]: image }));
          }
        })
        .catch(() => {
          // A missing cover just means the card falls back to its tone block.
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  /* The fetch effect. Stale responses are dropped by `requestRef` (the web
     aborted the in-flight fetches; searchSongs manages its own timeouts and
     RN reaps nothing by cancelling, so the guard is the whole story). */
  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    // Combos, cheapest meaningful set per selection (identical to web):
    // · vibes: several angles per vibe — one rooted in the first language,
    //   one open, plus all other selected languages rooted;
    // · no vibes: the region's own queries as before.
    const combos: { query: string; page: number }[] = [];
    if (freeText) {
      // A named-song lookup stays intact; mood/language preferences only
      // break ranking ties, never rewrite the title sent to the catalogue.
      combos.push({ query: freeText, page: firstPage + batch });
    } else {
      for (const activeRegion of activeRegions) {
        if (!activeVibes.length) {
          for (const query of activeRegion.queries) {
            combos.push({ query, page: firstPage + batch });
          }
        }
      }
      if (activeVibes.length) {
        for (const vibe of activeVibes) {
          // Rooted in the first selected language first, then an open angle,
          // then the remaining languages rooted — all one page deep each.
          const angles: string[] = [
            `${activeRegions[0].label.toLowerCase()} ${vibe.queries[0]}`,
            vibe.queries[1] ?? vibe.queries[0],
            ...activeRegions
              .slice(1)
              .map((candidate) => `${candidate.label.toLowerCase()} ${vibe.queries[0]}`),
          ];
          for (const query of angles.slice(0, 6)) {
            combos.push({ query, page: firstPage + batch });
          }
        }
      }
    }

    /** searchSongs applies the web route's limits and duplicate headroom. */
    const fetchPage = (query: string, page: number): Promise<PageResult> => {
      return (freeText ? searchSongMatches : searchSongs)(query, PAGE_SIZE, page)
        .then((payload) => ({ songs: payload.songs, total: payload.total }))
        .catch((cause: unknown) => {
          // One flaky page must not sink the whole batch.
          return { error: cause instanceof Error ? cause.message : "Search failed." };
        });
    };

    // Pages load in parallel; failed ones simply contribute no tracks.
    Promise.all(combos.map(({ query, page }) => fetchPage(query, page)))
      .then((responses) => {
        if (requestRef.current !== requestId) return;

        /** One deduped list per combo, in combo order for interleaving. */
        const usableByPosition: Song[][] = combos.map(() => []);
        const seen = new Set<string>();
        let failure: string | null = null;

        responses.forEach((response, position) => {
          if (!response) return;
          if ("error" in response) {
            failure ??= response.error;
            return;
          }
          const list = usableByPosition[position];
          for (const song of response.songs ?? []) {
            const key = songFingerprint(song);
            if (!seen.has(key)) {
              seen.add(key);
              list.push(song);
            }
          }
        });

        if (!usableByPosition.some((list) => list.length > 0) && failure) {
          throw new Error(failure);
        }

        // Pool, dedupe, then rank: relevance to the typed phrase first, then
        // checked vibes, then the language mix. An artist cap spreads the page
        // across voices so one singer cannot own the whole list.
        const regionLabels = freeText
          ? REGIONS.filter((candidate) => selectedLangs.includes(candidate.label)).map(
              (candidate) => candidate.label
            )
          : activeRegions.map((candidate) => candidate.label);
        const selected = rankSongs(dedupeSongs(usableByPosition.flat()), {
          query: freeText,
          vibes: activeVibes,
          regionLabels,
        }).slice(0, pageSize);

        // The catalogue had nothing at this visit's opening spot — fall back
        // to its first page rather than showing an empty feed.
        if (!selected.length && firstPage > 1 && batch === 0) {
          setFeedOffset(0);
          return;
        }

        const total = responses.reduce(
          (sum, response) =>
            response && "total" in response && typeof response.total === "number"
              ? Math.max(sum, response.total)
              : sum,
          0
        );

        setLibrary((prev) =>
          prev.termKey === termKey
            ? // A page turn replaces the visible ten with the fresh ten;
              // the old page stays visible until this batch lands.
              { ...prev, songs: selected, total: total || prev.total }
            : { termKey, songs: selected, total, drained: selected.length === 0 }
        );
        setError(null);
        setLoadedKey(requestKey);
      })
      .catch((cause: unknown) => {
        if (requestRef.current !== requestId) return;
        setError(cause instanceof Error ? cause.message : "Search failed.");
        setLoadedKey(requestKey);
      });
    // `library` is intentionally not a dependency: merges read-and-write via
    // the setState updater, and watching it would refetch on every merge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termKey, batch]);

  const songs = library.termKey === termKey ? library.songs : [];
  /** True while the first results for a new query are still on the wire. */
  const listLoading = fetching && songs.length === 0;
  /** Pages left to walk, counted from wherever this visit opened. */
  const pageCount = Math.max(1, Math.ceil((library.total - (firstPage - 1) * pageSize) / pageSize));

  /* ── Page chaining ─────────────────────────────────────────────────────
   * The last track of a page turns the page, and the fresh ten join the queue
   * instead of the queue running out and restarting from the top. Only a queue
   * started from this list participates. */
  useEffect(() => {
    const active = chain.current;
    if (
      !active ||
      !playing ||
      shuffle ||
      repeat === "one" ||
      queue.length === 0 ||
      index < queue.length - 1 ||
      active.key !== termKey ||
      active.page !== batch ||
      queue[0]?.id !== active.firstId ||
      fetching ||
      error ||
      !songs.length ||
      batch + 1 >= pageCount ||
      batch >= MAX_CHAIN_PAGES
    ) {
      return;
    }
    // The turn is spent on the track that ends this run, so an all-duplicate
    // page cannot keep asking the catalogue for another one.
    const turnToken = queue[queue.length - 1]?.id ?? "";
    if (active.turnToken === turnToken) return;
    const frame = requestAnimationFrame(() => {
      active.turnToken = turnToken;
      setBatch((value) => value + 1);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    playing,
    shuffle,
    repeat,
    queue,
    index,
    termKey,
    batch,
    fetching,
    error,
    songs.length,
    pageCount,
  ]);

  useEffect(() => {
    const active = chain.current;
    if (!active || active.key !== termKey || active.page + 1 !== batch) return;
    // The queue must still be the run this chain opened.
    if (queue.length === 0 || queue[0]?.id !== active.firstId) {
      chain.current = null;
      return;
    }
    if (fetching) return;
    const landed = library.termKey === termKey ? library.songs : [];
    if (!landed.length || error) {
      // Nothing to chain into: put the page that is still playing back on
      // screen and let the queue behave the way it always has.
      const frame = requestAnimationFrame(() => {
        chain.current = null;
        setBatch(active.page);
      });
      return () => cancelAnimationFrame(frame);
    }
    const held = new Set(queue.map((song) => song.id));
    const frame = requestAnimationFrame(() => {
      appendQueue(landed);
      active.page = batch;
      // A page of songs the queue already holds adds nothing; two of those in
      // a row means the catalogue has stopped giving new tracks.
      active.empties = landed.some((song) => !held.has(song.id)) ? 0 : active.empties + 1;
      if (active.empties >= 2) chain.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [batch, fetching, error, termKey, queue, library, appendQueue]);

  /* Backstop for the chain above: when the last track of the run ends, ask for
   * its next page instead of looping the same ten or sitting silent. */
  useEffect(() => {
    setQueueEnd(() => {
      const active = chain.current;
      if (!active || active.key !== termKey || active.page !== batch) return false;
      if (fetching || error || batch + 1 >= pageCount || batch >= MAX_CHAIN_PAGES) return false;
      setBatch((value) => value + 1);
      return true;
    });
    return () => setQueueEnd(null);
  }, [batch, error, fetching, pageCount, setQueueEnd, termKey]);

  /** Card heading: a typed phrase leads, then vibes, then the region mix. */
  const libraryTitle = freeText
    ? `${freeText}${activeVibes.length ? ` · ${activeVibes.map((vibe) => vibe.label).join(" + ")}` : ""}`
    : activeVibes.length
      ? activeRegions.length > 1 || activeVibes.length > 1
        ? `Filtered mix · ${activeVibes.map((vibe) => vibe.label).join(" + ")}`
        : `${activeRegions[0].label} · ${activeVibes[0].label}`
      : activeRegions.length > 1
        ? "Multi-language mix"
        : isRegion
          ? activeRegions[0].hint
          : "Search results";

  /** Queue the visible page and hand that run to the page chain. */
  const playFromPage = (songIndex: number) => {
    if (!isGuest) {
      chain.current = {
        key: termKey,
        page: batch,
        // The queue's opening track, whatever position was pressed.
        firstId: songs[0]?.id ?? "",
        turnToken: "",
        empties: 0,
      };
    }
    startQueue(songs, term, songIndex);
  };

  /** Shuffle-play the visible list: mix the queue, then start at the top. */
  const shufflePlay = () => {
    if (!songs.length) return;
    // A shuffled run never reaches "the last track" in order, so it stays out
    // of the chain and keeps looping the list it was given.
    chain.current = null;
    const mixed = [...songs];
    for (let i = mixed.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [mixed[i], mixed[j]] = [mixed[j], mixed[i]];
    }
    if (!shuffle) toggleShuffle();
    startQueue(mixed, term, 0);
  };

  /** Another spot in the catalogue, so the list is never the one you just saw. */
  const refreshFeed = () => {
    const step = 1 + Math.floor(Math.random() * (FEED_ROTATION - 1));
    setFeedOffset((value) => (value + step) % FEED_ROTATION);
    setBatch(0);
    setError(null);
  };

  /** Live bars with the animated mimic fallback. */
  const renderWave = (className: string, tone: "text-white" | "text-brand") => (
    <View className={cn("items-center justify-center p-1", className)}>
      {visualizerReady ? (
        <Waveform
          getAnalyser={getAnalyser}
          active={playing}
          className="h-full w-full"
          color={tone === "text-white" ? "#ffffff" : undefined}
        />
      ) : (
        <EqBars className="h-full w-full" color={tone === "text-white" ? "#ffffff" : undefined} />
      )}
    </View>
  );

  const pageHeader = (
    <>
      {/* Oversized wordmark — the song's RGB inside the letters flooding on
          every beat. Absolutely placed so it owns no layout space. */}
      <View className="relative">
        <View className="pointer-events-none absolute -top-5 end-0 select-none overflow-hidden">
          <BeatWordmark
            getAnalyser={getAnalyser}
            playing={playing}
            hueSeed={songHueSeed(activeId)}
            className="text-[80px] font-black leading-none tracking-tighter"
          >
            ZYRAVA
          </BeatWordmark>
        </View>
        <PageHeader
          title="ZYRAVA"
          leading={
            <Pressable
              onPress={() => setMobileNavOpen(true)}
              accessibilityLabel="Open the dock"
              className="size-10 flex-none items-center justify-center rounded-xl border border-separator bg-surface shadow-field"
            >
              <Icon name="menu" className="size-5" />
            </Pressable>
          }
          actions={
            <SearchWithSuggestions
              value={input}
              onChange={setInput}
              onPick={(song) => startQueue([song], song.title, 0)}
              onCommit={(query) => {
                setTerm(query);
                setBatch(0);
                // Enter returns to the retained search results.
                setHomeTab("songs");
                scrollToAnchor("library-list");
              }}
              className="w-full"
            />
          }
        />
      </View>

      <PersonalHeader />
      <HomeTabs value={homeTab} onChange={openTab} />
    </>
  );
  const panelStyle = {
    flexGrow: 1,
    paddingBottom: queue.length ? 260 : 32,
    paddingTop: 16,
    paddingHorizontal: 16,
  };

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 pt-4">{pageHeader}</View>
      <HomeTabPanel active={homeTab === "songs"}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={panelStyle}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View
            onLayout={(event) => {
              contentOffset.current = event.nativeEvent.layout.y;
            }}
          >
            {/* Multi-check filter bar — the top section's quick pickers. */}
            <View className="py-1">
              <View className="flex-row items-center justify-between gap-3 px-3.5 pt-3 pb-1">
                <Text className="text-[11px] font-bold uppercase tracking-[1.4px] text-muted-foreground">
                  Filters
                </Text>
                {selectedLangs.length + selectedVibes.length > 1 ? (
                  <Pressable
                    onPress={clearFilters}
                    className="min-h-7 flex-row items-center gap-1 rounded-full px-2"
                  >
                    <Icon name="x" className="size-3" />
                    <Text className="text-[11px] font-semibold text-muted">Clear all</Text>
                  </Pressable>
                ) : null}
              </View>

              <FilterRow
                label="Language"
                chips={REGIONS.map((candidate) => ({
                  key: candidate.label,
                  label: candidate.label,
                  checked:
                    selectedLangs.length > 0
                      ? selectedLangs.includes(candidate.label)
                      : candidate.label === baseRegion.label,
                  onPress: () => toggleLang(candidate.label),
                }))}
              />
              <FilterRow
                label="Vibe"
                chips={VIBES.map((vibe) => ({
                  key: vibe.value,
                  label: vibe.label,
                  checked: selectedVibes.includes(vibe.value),
                  onPress: () => toggleVibe(vibe.value),
                }))}
              />

              {selectedLangs.length + selectedVibes.length > 0 ? (
                <View className="border-t border-separator px-3.5 py-2 flex-row items-center gap-2">
                  <Text className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted">
                    Showing{" "}
                    <Text className="font-bold text-foreground">
                      {[
                        selectedLangs.length
                          ? selectedLangs.join(" + ")
                          : `${baseRegion.label} (current region)`,
                        ...selectedVibes.map(
                          (value) => VIBES.find((vibe) => vibe.value === value)?.label ?? value
                        ),
                      ].join(" · ")}
                    </Text>
                  </Text>
                  <View className="flex-none rounded-full bg-surface-secondary px-2 py-0.5">
                    <Text className="text-[10px] font-bold text-muted">
                      {selectedLangs.length + selectedVibes.length} active
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>

            {freeText ? (
              <PlaylistStrip query={freeText} onOpen={() => openTab("playlists")} />
            ) : null}

            {/* Featured rotation — hero panes per region. */}
            <View className="mt-5">
              <RegionCarousel
                covers={covers}
                active={isRegion ? term : ""}
                nowPlaying={queueLabel}
                onPlay={playRegionNow}
                onSelect={openRegion}
              />
            </View>

            {/* Picks built from what this listener actually plays. */}
            <View className="mt-5">
              <Recommendations />
            </View>

            {/* One scrolling rail of language cards. */}
            <View nativeID="region-library" onLayout={anchor("region-library")} className="mt-8">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 12 }}
              >
                {REGIONS.map((candidate) => {
                  const isActive = candidate.label === term;
                  return (
                    <Pressable
                      key={candidate.label}
                      onPress={() => openRegion(candidate.label)}
                      className={cn(
                        "relative aspect-square w-32 flex-none overflow-hidden",
                        isActive ? "opacity-100" : "opacity-80"
                      )}
                    >
                      {covers[candidate.label] ? (
                        <Image
                          source={{ uri: covers[candidate.label] }}
                          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                          contentFit="cover"
                        />
                      ) : (
                        <View
                          className={cn(
                            "absolute inset-0 items-center justify-center",
                            candidate.toneClassName
                          )}
                        >
                          <Icon name="globe" className="size-8" color="rgba(0,0,0,0.6)" />
                        </View>
                      )}
                      <Scrim className="absolute inset-0" colors={SCRIM_STOPS.rail} />
                      <View
                        className={cn(
                          "absolute end-2.5 top-2.5 size-8 items-center justify-center rounded-full bg-white",
                          isActive ? "opacity-100" : "opacity-70"
                        )}
                      >
                        {isActive && playing ? (
                          <EqBars className="h-3 w-3" color="#ffffff" />
                        ) : (
                          <Icon name="play" size={15} color="#000" />
                        )}
                      </View>
                      <View className="absolute inset-x-0 bottom-0 p-3">
                        <Text className="truncate text-sm font-bold text-white">
                          {candidate.label}
                        </Text>
                        <Text className="truncate text-[11px] text-white/80">{candidate.hint}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <View className="mt-7 flex-row flex-wrap items-center justify-between gap-3">
              <Text className="text-lg font-bold tracking-tight text-foreground">
                {isRegion ? `${term} · music` : "Search results"}
              </Text>
              <View className="w-full min-w-0 flex-row flex-wrap items-center gap-2">
                <Pressable
                  onPress={shufflePlay}
                  disabled={!songs.length}
                  className={cn(
                    "min-h-11 flex-row items-center gap-2 px-3.5",
                    !songs.length && "opacity-40",
                    shuffle ? "bg-accent-soft" : "bg-surface-secondary"
                  )}
                >
                  <Icon name="shuffle" className="size-3.5" />
                  <Text
                    className={cn("text-xs font-semibold", shuffle ? "text-brand" : "text-muted")}
                  >
                    Shuffle
                  </Text>
                </Pressable>
                <View className="max-w-full flex-row items-center gap-2">
                  {freeText ? null : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Refresh music"
                      accessibilityState={{ disabled: fetching, busy: fetching }}
                      onPress={refreshFeed}
                      disabled={fetching}
                      className={cn(
                        "size-11 items-center justify-center active:bg-surface-secondary",
                        fetching && "opacity-40"
                      )}
                    >
                      <Icon name="refresh" className="size-4 text-muted" />
                    </Pressable>
                  )}
                  <View
                    accessibilityLabel="Library view"
                    className="flex-row items-center gap-0.5 bg-surface-secondary p-0.5"
                  >
                    {VIEW_OPTIONS.map((option) => (
                      <Pressable
                        key={option.value}
                        accessibilityRole="button"
                        accessibilityLabel={option.label}
                        accessibilityState={{ selected: view === option.value }}
                        onPress={() => setView(option.value)}
                        className={cn(
                          "size-10 items-center justify-center",
                          view === option.value
                            ? "bg-accent-soft"
                            : "opacity-50 active:bg-surface-secondary active:opacity-100"
                        )}
                      >
                        {option.icon}
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
            </View>

            {error ? (
              <View className="mt-4">
                <Notice
                  tone="warning"
                  title="Music search is unavailable"
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onPress={() => {
                        setError(null);
                        setAttempt((value) => value + 1);
                      }}
                    >
                      Retry
                    </Button>
                  }
                >
                  {error}
                </Notice>
              </View>
            ) : null}

            <View onLayout={anchor("library-list")} className="mt-6">
              <View className="mb-4 flex-row items-center justify-between gap-3">
                <View className="min-w-0 flex-1">
                  <Text
                    accessibilityRole="header"
                    className="text-xl font-semibold text-foreground"
                  >
                    {libraryTitle}
                  </Text>
                  <Text className="mt-1 text-xs text-muted">
                    {listLoading
                      ? "Loading tracks…"
                      : `${library.total.toLocaleString("en-IN")} tracks${pageCount > 1 ? ` · Page ${batch + 1} of ${pageCount}` : ""}`}
                  </Text>
                </View>
                {fetching ? <Spinner /> : null}
              </View>
              {listLoading ? (
                <View>
                  {view === "list" ? (
                    <View className="gap-2">
                      {Array.from({ length: 12 }).map((_, tileIndex) => (
                        <Skeleton key={tileIndex} className="h-16 rounded-none" />
                      ))}
                    </View>
                  ) : (
                    <View className="flex-row flex-wrap p-1.5">
                      {Array.from({ length: view === "large" ? 6 : 12 }).map((_, tileIndex) => (
                        <View
                          key={tileIndex}
                          className="gap-2.5 px-1.5 pb-3"
                          style={{ width: `${100 / GRID_COLS[view]}%` }}
                        >
                          <Skeleton className="aspect-square w-full rounded-none" />
                          <Skeleton className="h-3.5 w-3/4" />
                          <Skeleton className="h-3 w-1/2" />
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              ) : songs.length ? (
                <View>
                  {view === "list" ? (
                    <View className="gap-1">
                      {songs.map((song, songIndex) => {
                        const isActive = song.id === activeId;
                        return (
                          <View key={song.id} className="relative">
                            <Pressable
                              onPress={() => playFromPage(songIndex)}
                              accessibilityLabel={`Play ${song.title} by ${song.artist}`}
                              accessibilityState={{ busy: isActive && trackLoading }}
                              className={cn(
                                "min-h-[72px] flex-row items-center gap-3 py-3 ps-1 pe-[104px] active:opacity-70",
                                isActive && "bg-accent-soft"
                              )}
                            >
                              <View className="relative size-12 flex-none overflow-hidden bg-surface-muted">
                                {song.image ? (
                                  <Image
                                    source={{ uri: song.image }}
                                    style={{
                                      position: "absolute",
                                      inset: 0,
                                      width: "100%",
                                      height: "100%",
                                    }}
                                    contentFit="cover"
                                  />
                                ) : (
                                  <View className="h-full items-center justify-center">
                                    <Icon name="music" size={16} />
                                  </View>
                                )}
                                <View
                                  className={cn(
                                    "absolute inset-0 items-center justify-center bg-black/50",
                                    isActive ? "opacity-100" : "opacity-0"
                                  )}
                                >
                                  {isActive && trackLoading ? (
                                    <ActivityIndicator
                                      size="small"
                                      color="#fff"
                                      accessibilityLabel={`Loading ${song.title}`}
                                    />
                                  ) : isActive && playing ? (
                                    renderWave("h-full w-full", "text-white")
                                  ) : (
                                    <Icon name="play" size={16} color="#fff" />
                                  )}
                                </View>
                              </View>
                              <View className="min-w-0 flex-1">
                                <Text
                                  className={cn(
                                    "truncate text-sm font-semibold",
                                    isActive ? "text-brand" : "text-foreground"
                                  )}
                                  numberOfLines={1}
                                >
                                  {song.title}
                                </Text>
                                <Text className="truncate text-xs text-muted" numberOfLines={1}>
                                  {formatSeconds(song.duration)} · {song.artist}
                                  {song.album ? ` · ${song.album}` : ""}
                                </Text>
                              </View>
                            </Pressable>

                            <View className="absolute end-1.5 top-1/2 z-10 -translate-y-1/2 flex-row items-center">
                              <Pressable
                                onPress={() => toggleLike(song)}
                                accessibilityRole="button"
                                className="size-8 items-center justify-center rounded-full"
                              >
                                <Icon
                                  name="heart"
                                  className="size-4"
                                  color={isLiked(song) ? "var(--danger)" : "var(--muted)"}
                                />
                              </Pressable>
                              <Pressable
                                onPress={() => openPicker(song)}
                                className="size-8 items-center justify-center rounded-full"
                              >
                                <Icon name="plus" className="size-4" color="var(--muted)" />
                              </Pressable>
                              <SaveToDevice song={song} />
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    <View className="flex-row flex-wrap p-1.5">
                      {songs.map((song, songIndex) => {
                        const isActive = song.id === activeId;
                        const src = song.imageLarge || song.image;
                        return (
                          <View
                            key={song.id}
                            className="relative gap-2.5 px-1.5 pb-3"
                            style={{ width: `${100 / GRID_COLS[view]}%` }}
                          >
                            <Pressable
                              onPress={() => toggleLike(song)}
                              className="absolute start-2 top-2 z-10 size-8 items-center justify-center rounded-full bg-black/50"
                            >
                              <Icon
                                name="heart"
                                className="size-4"
                                color={isLiked(song) ? "var(--danger)" : "rgba(255,255,255,0.85)"}
                              />
                            </Pressable>
                            <Pressable
                              onPress={() => playFromPage(songIndex)}
                              accessibilityLabel={`Play ${song.title} by ${song.artist}`}
                              accessibilityState={{ busy: isActive && trackLoading }}
                              className="relative aspect-square w-full overflow-hidden bg-surface-muted active:opacity-70"
                            >
                              {src ? (
                                <Image
                                  source={{ uri: src }}
                                  style={{
                                    position: "absolute",
                                    inset: 0,
                                    width: "100%",
                                    height: "100%",
                                  }}
                                  alt=""
                                  contentFit="cover"
                                  transition={150}
                                />
                              ) : (
                                <View className="h-full items-center justify-center">
                                  <Icon name="music" size={28} />
                                </View>
                              )}
                              <View
                                className={cn(
                                  "absolute inset-0 items-center justify-center bg-black/45",
                                  isActive ? "opacity-100" : "opacity-0"
                                )}
                              >
                                {isActive && trackLoading ? (
                                  <ActivityIndicator
                                    size="large"
                                    color="#fff"
                                    accessibilityLabel={`Loading ${song.title}`}
                                  />
                                ) : isActive && playing ? (
                                  renderWave("h-2/3 w-2/3", "text-white")
                                ) : (
                                  <Icon
                                    name="play"
                                    size={view === "large" ? 22 : 18}
                                    color="#fff"
                                  />
                                )}
                              </View>
                              {view === "large" ? (
                                <View className="absolute end-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5">
                                  <Text className="text-[10px] font-semibold text-white">
                                    {formatSeconds(song.duration)}
                                  </Text>
                                </View>
                              ) : null}
                            </Pressable>
                            <View className="min-w-0 pb-1">
                              <Text
                                className={cn(
                                  "truncate font-semibold",
                                  isActive ? "text-brand" : "text-foreground",
                                  view === "small" ? "text-xs" : "text-sm"
                                )}
                                numberOfLines={1}
                              >
                                {song.title}
                              </Text>
                              <Text
                                className="mt-0.5 truncate text-xs text-muted"
                                numberOfLines={1}
                              >
                                {song.artist}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              ) : (
                <View className="py-4">
                  <EmptyState
                    icon={
                      <Icon name={activeVibes.length ? "sliders" : "search"} className="size-5" />
                    }
                    title={
                      activeVibes.length
                        ? "No songs matched the selected filters"
                        : "Nothing matched that search"
                    }
                    description={
                      activeVibes.length
                        ? "Even the mixed vibe-and-language pool came back empty — untick a vibe or language and retry."
                        : "Try a shorter phrase, an artist name, or one of the regions above."
                    }
                  />
                </View>
              )}
            </View>

            {/* Numbered pages: 1 · 2 · 3 … next — each next lists ten more. */}
            {pageCount > 1 && songs.length ? (
              <Pagination
                page={batch + 1}
                pageCount={pageCount}
                total={library.total}
                pageSize={pageSize}
                onChange={(value) => openPage(value - 1)}
                className="mt-2"
              />
            ) : null}

            {/* Label line — the quiet footer, Zomato style. */}
            <View className="mt-16 px-2 pb-4 items-center">
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
                accessibilityLabel="Crafted with love in Kochi, India"
                className="w-full text-center text-[18px] font-black leading-6 tracking-tight text-foreground/10"
              >
                Crafted with <Text className="text-danger">♥</Text> in Kochi, India
              </Text>
            </View>
          </View>
        </ScrollView>
      </HomeTabPanel>
      {!isGuest ? (
        <>
          {!personal ? (
            <>
              <HomeTabPanel active={homeTab === "customize"}>
                <CustomizationConsole key={user?.id} active={homeTab === "customize"} />
              </HomeTabPanel>
              <HomeTabPanel active={homeTab === "payments"}>
                <PaymentsHistory key={user?.id} />
              </HomeTabPanel>
            </>
          ) : null}
          <HomeTabPanel active={homeTab === "playlists"}>
            <ScrollView
              contentContainerStyle={panelStyle}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <PlaylistsView query={playlistQuery} />
            </ScrollView>
          </HomeTabPanel>
          <HomeTabPanel active={homeTab === "liked"}>
            <LikedView paddingBottom={panelStyle.paddingBottom} />
          </HomeTabPanel>
          <HomeTabPanel active={homeTab === "downloads"}>
            <ScrollView
              contentContainerStyle={panelStyle}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <DownloadsView />
            </ScrollView>
          </HomeTabPanel>
          <HomeTabPanel active={homeTab === "offline"}>
            <ScrollView
              contentContainerStyle={panelStyle}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <OfflineView onImport={() => setImportOpen(true)} />
            </ScrollView>
          </HomeTabPanel>
        </>
      ) : null}
      <ImportSongsModal open={importOpen} onClose={() => setImportOpen(false)} />
      <InstallModal />
    </View>
  );
}

/** A chip row (Language / Vibe) — horizontal scroll, checked pill styling. */
function FilterRow({
  label,
  chips,
}: {
  label: string;
  chips: { key: string; label: string; checked: boolean; onPress: () => void }[];
}): JSX.Element {
  return (
    <View className="flex-row items-center gap-3 border-t border-separator px-3.5 py-2.5">
      <Text
        numberOfLines={1}
        className="w-20 flex-none text-[10px] font-bold uppercase tracking-[1.2px] text-muted"
      >
        {label}
      </Text>
      <ScrollView
        horizontal
        className="min-w-0 flex-1"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexDirection: "row", alignItems: "center", gap: 6 }}
      >
        {chips.map((chip) => (
          <Pressable
            key={chip.key}
            onPress={chip.onPress}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: chip.checked }}
            className={cn(
              "h-9 flex-none flex-row items-center gap-1.5 rounded-full border px-3.5",
              chip.checked ? "border-transparent bg-accent" : "border-separator bg-transparent"
            )}
          >
            {chip.checked ? (
              <View className="size-3.5 items-center justify-center rounded-full">
                <Icon name="check" className="size-2.5" color="var(--accent-foreground)" />
              </View>
            ) : null}
            <Text
              className={cn(
                "text-xs font-semibold",
                chip.checked ? "text-accent-foreground" : "text-muted"
              )}
            >
              {chip.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function formatSeconds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
