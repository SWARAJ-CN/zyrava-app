import { useEffect, useMemo, useState } from "react";
import { Dimensions, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Link } from "expo-router";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { Slider } from "heroui-native";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EqBars } from "@/components/features/music/EqBars";
import { formatRuntime } from "@/lib/format";
import { useAuth } from "@/components/providers/AuthProvider";
import { useGuestLock } from "@/components/providers/GuestLockProvider";
import { useLibrary } from "@/components/providers/LibraryProvider";
import { useCommunity } from "@/components/providers/CommunityProvider";
import { useTheme } from "@/components/providers/ThemeProvider";
import {
  DEFAULT_VOLUME,
  EQ_PRESETS,
  SPATIAL_MODES,
  useMusicPlayer,
  type EqPreset,
  type SpatialMode,
} from "@/components/providers/MusicPlayerProvider";

/** heroui hands Slider changes as `number | number[]` — we always ask one value. */
function sliderValue(value: number | number[]): number {
  return Array.isArray(value) ? value[0] : value;
}

/* ------------------------------------------------------------------ *
 * The dock — ported as the mobile drawer component.
 *
 * The web renders a persistent left rail (⇄ wide via keyboard M) plus a
 * phone <dialog> drawer. On mobile there is only the drawer: AppChrome keeps
 * this mounted and it slides in over a backdrop while `mobileNavOpen` is on
 * (the Reanimated spring mirrors framer-motion's stiffness 420 / damping 40;
 * the web's 260 ms DRAWER_MS exit delay is what "stay mounted, animate out"
 * gives us natively). Rail width, the dock-morph cross-fade, the matchMedia
 * resize-close and the "M" keydown handler are desktop affordances — the
 * setter survives (setSidebarWide), the key handler is dropped.
 *
 * Hash anchors became callbacks: the home screen passes onBrowse/onRegions/
 * onLibraryList so a dock tap scrolls that screen (still closing the drawer
 * first, with the web's 140 ms hand-off). The install affordance is PWA-only
 * and gone (PORTING_CONVENTIONS #18).
 * ------------------------------------------------------------------ */

type DockTab = "browse" | "library" | "dashboard" | "mixer";

/**
 * `chat` is not a shelf of the dock — it is the door to the community room,
 * which draws over the page like the console does, so it never lands in `tab`.
 */
type DockEntry = DockTab | "chat";

const TABS: {
  value: DockEntry;
  label: string;
  icon: "music" | "heart" | "gauge" | "sliders" | "message";
}[] = [
  { value: "browse", label: "Browse", icon: "music" },
  { value: "library", label: "Library", icon: "heart" },
  { value: "dashboard", label: "Audio desk", icon: "gauge" },
  { value: "mixer", label: "Mixer", icon: "sliders" },
  { value: "chat", label: "Community", icon: "message" },
];

const BROWSE_LINKS: {
  label: string;
  id: "top" | "region-library" | "library-list";
  icon: "search" | "globe" | "list";
}[] = [
  { label: "Top of the page", id: "top", icon: "search" },
  { label: "Region library", id: "region-library", icon: "globe" },
  { label: "Song list", id: "library-list", icon: "list" },
];

/** Rows share one rhythm so every list in the dock reads as a single column. */
const ROW =
  "flex h-9 w-full flex-row items-center gap-3 rounded-lg px-2.5 text-[13px] font-medium transition-colors";

/** Quiet uppercase heading above a group of controls. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text className="px-2.5 pb-2 text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-muted">
      {children}
    </Text>
  );
}

/** Small square control used in the dock's header and footer. */
function DockIcon({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onClick}
      className="relative size-9 items-center justify-center rounded-lg text-muted transition-colors active:bg-dock-hover active:text-foreground active:scale-95"
    >
      {children}
    </Pressable>
  );
}

/**
 * The dock column itself. `wide` was the rail ⇄ panel switch; on mobile the
 * drawer always draws the full panel, so the flag stays for API parity.
 */
function DockBody({
  wide,
  mobile,
  onBrowse,
  onRegions,
  onLibraryList,
}: {
  wide: boolean;
  mobile: boolean;
  onBrowse?: () => void;
  onRegions?: () => void;
  onLibraryList?: () => void;
}) {
  const [tab, setTab] = useState<DockTab>("browse");
  const [heavyPending, setHeavyPending] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [playlistName, setPlaylistName] = useState("");
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [presetOpen, setPresetOpen] = useState(false);
  const {
    liked,
    playlists,
    createPlaylist,
    playLiked,
    playPlaylist,
    addToPlaylist,
    deletePlaylist,
  } = useLibrary();
  const { chatOpen, badge: chatBadge, openChat } = useCommunity();
  const {
    playing,
    queue,
    index,
    current,
    volume,
    muted,
    setVolume,
    preampDb,
    setPreampDb,
    balance,
    setBalance,
    rate,
    setRate,
    eqPreset,
    applyPreset,
    applyCustomPreset,
    spatialMode,
    setSpatialMode,
    nowPlayingOpen,
    setNowPlayingOpen,
    setSidebarWide,
    setMixerOpen,
    setMobileNavOpen,
    listenedSeconds,
    sessionPlays,
    getGraphInfo,
  } = useMusicPlayer();
  const { resolved, toggle } = useTheme();
  const { user, status: authStatus, logout } = useAuth();
  const { requireAuth } = useGuestLock();
  const accountName = user?.name ?? user?.email ?? user?.phone ?? "Account";
  const accountInitial = accountName.slice(0, 1).toUpperCase();

  // Live graph facts re-read on every dashboard render.
  const graph = getGraphInfo();

  const choosePreset = (preset: EqPreset) => {
    if (preset.heavy && eqPreset !== preset.label) {
      setHeavyPending(preset.label);
      return;
    }
    applyPreset(preset);
  };

  /** Jump to a section; a phone drawer steps aside before the page scrolls.
   *  (scrollIntoView → the home screen's own scroll callbacks.) */
  const go = (id: "top" | "region-library" | "library-list") => {
    const run = () => {
      if (id === "top") onBrowse?.();
      else if (id === "region-library") onRegions?.();
      else onLibraryList?.();
    };
    if (mobile) {
      setMobileNavOpen(false);
      setTimeout(run, 140);
    } else {
      run();
    }
  };

  const submitPlaylist = () => {
    const id = createPlaylist(playlistName);
    if (!id) {
      setPlaylistError("That name is empty or already used.");
      return;
    }
    setPlaylistName("");
    setPlaylistError(null);
    setCreating(false);
  };

  const resetMixer = () => {
    setVolume(DEFAULT_VOLUME);
    setPreampDb(0);
    setBalance(0);
    setRate(1);
    applyPreset(EQ_PRESETS[0]);
    setSpatialMode("off");
  };

  const themeLabel = resolved === "dark" ? "Switch to light theme" : "Switch to dark theme";
  const closeDock = mobile ? () => setMobileNavOpen(false) : () => setSidebarWide(false);

  return (
    <>
      {/* Brand head — the dock's own switch lives up here. */}
      <View
        className={cn(
          "flex h-16 flex-none flex-row items-center border-b border-dock-line",
          wide ? "gap-3 px-3.5" : "justify-center px-0"
        )}
      >
        {wide ? (
          <>
            <View className="size-8 flex-none items-center justify-center rounded-[0.6rem] bg-accent text-accent-foreground">
              <Icon name="music" className="size-4" strokeWidth={2.2} />
            </View>
            <View className="min-w-0 flex-1">
              <Text
                numberOfLines={1}
                className="truncate text-[12.5px] font-bold leading-none tracking-[0.22em] text-foreground"
              >
                ZYRAVA
              </Text>
              <Text className="mt-1.5 truncate text-[9px] font-medium uppercase leading-none tracking-[0.2em] text-muted">
                Audio studio
              </Text>
            </View>
            <DockIcon label={mobile ? "Close the dock" : "Collapse dock (M)"} onClick={closeDock}>
              <Icon name={mobile ? "x" : "sidebar"} className="size-4" strokeWidth={1.9} />
            </DockIcon>
          </>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => setSidebarWide(true)}
            accessibilityLabel="Expand dock (M)"
            className="size-9 items-center justify-center rounded-[0.6rem] bg-accent text-accent-foreground transition-transform active:scale-95"
          >
            <Icon name="music" className="size-4" strokeWidth={2.2} />
          </Pressable>
        )}
      </View>

      {/* Sections */}
      <View
        accessibilityRole="tablist"
        accessibilityLabel="Dock sections"
        className={cn(
          "flex flex-none flex-col",
          wide ? "gap-0.5 px-2.5 py-2.5" : "items-center gap-1 px-2 py-3"
        )}
      >
        {TABS.map((entry) => {
          const active = entry.value === "chat" ? chatOpen : tab === entry.value;
          return (
            <Pressable
              key={entry.value}
              accessibilityRole="tab"
              accessibilityLabel={entry.label}
              accessibilityState={{ selected: active }}
              onPress={() => {
                /* The community room is an overlay, not another shelf — it never
                   takes the dock's own tab state with it. */
                if (entry.value === "chat") {
                  if (!requireAuth("community")) return;
                  openChat();
                  if (mobile) setMobileNavOpen(false);
                  return;
                }
                /* Browsing the page is free; the shelves, the readings and the
                   console behind them are what an account is for. */
                const reason = entry.value === "mixer" ? "mixer" : "tab";
                if (entry.value !== "browse" && !requireAuth(reason)) return;
                setTab(entry.value);
                if (!wide) setSidebarWide(true);
              }}
              className={cn(
                "relative flex flex-row text-[13px] transition-colors duration-150",
                wide
                  ? cn(
                      "h-10 w-full gap-3 rounded-lg px-2.5",
                      active
                        ? "bg-dock-active font-semibold text-foreground"
                        : "font-medium text-muted active:bg-dock-hover active:text-foreground"
                    )
                  : cn(
                      "size-11 justify-center rounded-xl",
                      active
                        ? "bg-dock-active text-brand"
                        : "text-muted active:bg-dock-hover active:text-foreground"
                    )
              )}
            >
              <Icon
                name={entry.icon}
                className={cn("flex-none", wide ? "size-4.5" : "size-5", active && "text-brand")}
                strokeWidth={active ? 2.2 : 1.9}
              />
              {wide ? (
                <>
                  <Text numberOfLines={1} className="min-w-0 flex-1 truncate text-left">
                    {entry.label}
                  </Text>
                  {entry.value === "chat" && chatBadge ? (
                    <Text className="h-5 min-w-5 flex-none items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground tabular-nums">
                      {chatBadge > 9 ? "9+" : chatBadge}
                    </Text>
                  ) : active ? (
                    <View aria-hidden className="size-1.5 flex-none rounded-full bg-accent" />
                  ) : null}
                </>
              ) : entry.value === "chat" && chatBadge ? (
                <View
                  aria-hidden
                  className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent"
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {/* Panel body — the rail shows navigation only. */}
      {wide ? (
        <ScrollView
          className="min-h-0 flex-1 px-2.5 pb-4"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {tab === "browse" ? (
            <View className="flex-col gap-0.5">
              <SectionLabel>On this page</SectionLabel>
              {BROWSE_LINKS.map((link) => (
                <Pressable
                  key={link.id}
                  accessibilityRole="button"
                  onPress={() => go(link.id)}
                  className={cn(ROW, "text-muted active:bg-dock-hover active:text-foreground")}
                >
                  <Icon name={link.icon} className="size-4 flex-none" strokeWidth={1.9} />
                  <Text className="truncate">{link.label}</Text>
                </Pressable>
              ))}

              <View aria-hidden className="my-2 h-px bg-dock-line" />

              <Pressable
                accessibilityRole="button"
                onPress={() => setNowPlayingOpen(!nowPlayingOpen)}
                accessibilityState={{ selected: nowPlayingOpen }}
                className={cn(
                  ROW,
                  nowPlayingOpen
                    ? "bg-dock-active text-foreground"
                    : "text-muted active:bg-dock-hover active:text-foreground"
                )}
              >
                <Icon
                  name="waves"
                  className={cn("size-4 flex-none", nowPlayingOpen && "text-brand")}
                  strokeWidth={nowPlayingOpen ? 2.1 : 1.9}
                />
                <Text className="truncate">Now playing panel</Text>
              </Pressable>
            </View>
          ) : null}

          {tab === "dashboard" ? (
            <View className="flex-col gap-5">
              <View>
                <SectionLabel>This session</SectionLabel>
                {/* grid-cols-2 gap-px via a two-column wrap; dock-line shows
                    through the 1px gaps like the web's separator grid. */}
                <View className="flex-row flex-wrap bg-dock-line overflow-hidden rounded-xl">
                  <Stat label="Listening" value={formatRuntime(listenedSeconds)} />
                  <Stat
                    label="Queued"
                    value={`${queue.length || 0}`}
                    hint={`track ${Math.max(1, index + 1)}`}
                  />
                  <Stat label="Plays" value={`${sessionPlays}`} hint="this session" />
                  <Stat
                    label="Engine"
                    value={graph.webAudio ? "Web Audio" : "Native"}
                    hint={
                      graph.webAudio
                        ? `${graph.sampleRate ?? 48} kHz · ${graph.channels ?? 2} ch`
                        : "graph idle"
                    }
                  />
                </View>
              </View>

              <View>
                <SectionLabel>Signal chain</SectionLabel>
                <View className="flex-col border-y border-dock-line">
                  {[
                    { head: "Source", tail: current ? "320 kbps AAC" : "idle" },
                    {
                      head: "Pre-amp",
                      tail: `${preampDb > 0 ? "+" : ""}${preampDb.toFixed(0)} dB`,
                    },
                    { head: "EQ", tail: eqPreset },
                    {
                      head: "Space",
                      tail:
                        SPATIAL_MODES.find((mode) => mode.value === spatialMode)?.label ?? "Off",
                    },
                    {
                      head: "Output",
                      tail: graph.webAudio ? `${graph.sampleRate ?? 48} kHz` : "element",
                    },
                  ].map((row) => (
                    <View
                      key={row.head}
                      className={cn(
                        "flex-row items-baseline justify-between gap-3 px-2.5 py-2",
                        row.head !== "Source" && "border-t border-dock-line"
                      )}
                    >
                      <Text className="text-[12px] font-medium text-muted">{row.head}</Text>
                      <Text
                        numberOfLines={1}
                        className="min-w-0 truncate text-[12px] font-semibold text-foreground"
                      >
                        {row.tail}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              {playing ? (
                <View className="flex-row items-center gap-2 rounded-lg bg-dock-active px-2.5 py-2">
                  <Icon name="activity" className="size-3.5 flex-none text-brand" strokeWidth={2} />
                  <Text className="text-[11px] font-medium text-brand">Waveform live</Text>
                  <View className="ml-auto">
                    <EqBars />
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {tab === "library" ? (
            <View className="flex-col gap-5">
              <View>
                <SectionLabel>Liked songs</SectionLabel>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    playLiked();
                    if (mobile) setMobileNavOpen(false);
                  }}
                  className={cn(ROW, "text-muted active:bg-dock-hover active:text-foreground")}
                >
                  <View className="size-7 flex-none items-center justify-center rounded-full bg-danger-soft text-danger-soft-foreground">
                    <Icon name="heart" className="size-3.5 fill-current" strokeWidth={1.8} />
                  </View>
                  <Text className="min-w-0 flex-1 truncate">Liked songs</Text>
                  <Text className="flex-none text-[10px] font-medium tabular-nums text-faint-foreground">
                    {liked.length}
                  </Text>
                </Pressable>
              </View>

              <View>
                <View className="flex-row items-center justify-between px-2.5 pb-2">
                  <Text className="text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-muted">
                    Your playlists
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setCreating((value) => !value);
                      setPlaylistError(null);
                    }}
                    className="flex-row items-center gap-1"
                  >
                    <Icon name="plus" className="size-3.5 text-muted" strokeWidth={2} />
                    <Text className="text-[11px] font-medium text-muted active:text-foreground">
                      New
                    </Text>
                  </Pressable>
                </View>

                {creating ? (
                  <View className="mb-2 px-2.5">
                    <View className="flex-row gap-1.5">
                      <TextInput
                        value={playlistName}
                        onChangeText={(next) => {
                          setPlaylistName(next);
                          setPlaylistError(null);
                        }}
                        onSubmitEditing={submitPlaylist}
                        maxLength={40}
                        placeholder="Playlist name"
                        accessibilityLabel="New playlist name"
                        className="h-9 min-w-0 flex-1 rounded-lg border border-dock-line bg-surface-secondary/50 px-2.5 text-foreground placeholder:text-faint-foreground"
                      />
                      <Pressable
                        accessibilityRole="button"
                        onPress={submitPlaylist}
                        className="h-9 flex-none rounded-lg bg-accent px-2.5 items-center justify-center"
                      >
                        <Text className="text-[11px] font-semibold text-accent-foreground">
                          Add
                        </Text>
                      </Pressable>
                    </View>
                    {playlistError ? (
                      <Text className="pt-1 text-[10px] text-danger-soft-foreground">
                        {playlistError}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                <View className="flex-col gap-0.5">
                  {playlists.map((playlist) => (
                    <View key={playlist.id} className="flex-row items-center gap-0.5">
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          playPlaylist(playlist.id);
                          if (mobile) setMobileNavOpen(false);
                        }}
                        accessibilityLabel={`Play playlist ${playlist.name}`}
                        className={cn(
                          ROW,
                          "min-w-0 flex-1 text-muted active:bg-dock-hover active:text-foreground"
                        )}
                      >
                        <Icon name="list" className="size-4 flex-none" strokeWidth={1.9} />
                        <Text numberOfLines={1} className="min-w-0 flex-1 truncate">
                          {playlist.name}
                        </Text>
                        <Text className="flex-none text-[10px] tabular-nums text-faint-foreground">
                          {playlist.songs.length}
                        </Text>
                      </Pressable>
                      {current ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => addToPlaylist(playlist.id, current)}
                          accessibilityLabel={`Add the playing song to ${playlist.name}`}
                          className="size-7 flex-none items-center justify-center rounded-md text-faint-foreground transition-colors active:bg-dock-hover active:text-foreground"
                        >
                          <Icon name="plus" className="size-3.5" strokeWidth={2} />
                        </Pressable>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => deletePlaylist(playlist.id)}
                        accessibilityLabel={`Delete playlist ${playlist.name}`}
                        className="size-7 flex-none items-center justify-center rounded-md text-faint-foreground transition-colors active:bg-dock-hover"
                      >
                        <Icon name="trash" className="size-3.5" strokeWidth={1.9} />
                      </Pressable>
                    </View>
                  ))}

                  {!playlists.length && !creating ? (
                    <Text className="px-2.5 pb-1 text-[11px] leading-relaxed text-faint-foreground">
                      Create a playlist, then add songs with the + button on any track.
                    </Text>
                  ) : null}
                </View>
              </View>

              <View className="px-2.5">
                <Text className="rounded-lg bg-dock-active px-2.5 py-2 text-[10px] leading-relaxed text-muted">
                  Likes and playlists are saved on this device for your account.
                </Text>
              </View>
            </View>
          ) : null}

          {tab === "mixer" ? (
            <View className="flex-col gap-5">
              <View className="flex-col gap-2.5">
                <View className="flex-row items-baseline justify-between gap-2 px-2.5">
                  <Text className="text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-muted">
                    Studio mixer
                  </Text>
                  <Pressable accessibilityRole="button" onPress={resetMixer} className="rounded-md">
                    <Text className="text-[11px] font-medium text-muted active:text-foreground">
                      Reset
                    </Text>
                  </Pressable>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setMixerOpen(true);
                    if (mobile) setMobileNavOpen(false);
                  }}
                  className="flex h-10 w-full flex-row items-center justify-center gap-2 rounded-lg bg-brand px-3 active:bg-brand-hover active:scale-[0.99]"
                >
                  <Icon name="sliders" className="size-4 text-brand-foreground" strokeWidth={2.1} />
                  <Text className="text-[12.5px] font-semibold text-brand-foreground">
                    Open the sound console
                  </Text>
                </Pressable>
              </View>

              <View className="flex-col gap-4 px-2.5">
                <Fader
                  label="Master volume"
                  value={volume}
                  display={`${Math.round(volume * 100)}%${muted ? " (muted)" : ""}`}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(value) => setVolume(value)}
                />
                <Fader
                  label="Pre-amp gain"
                  value={preampDb}
                  display={`${preampDb > 0 ? "+" : ""}${preampDb.toFixed(0)} dB`}
                  min={-6}
                  max={12}
                  step={1}
                  onChange={setPreampDb}
                  hint="Tips the whole chain hot — small steps go far"
                />
                <Fader
                  label="Balance L ↔ R"
                  value={balance}
                  display={
                    balance === 0
                      ? "centred"
                      : `${balance < 0 ? "L" : "R"} ${Math.abs(Math.round(balance * 100))}%`
                  }
                  min={-1}
                  max={1}
                  step={0.05}
                  onChange={setBalance}
                />
                <Fader
                  label="Tempo"
                  value={rate}
                  display={`${rate.toFixed(2)}×`}
                  min={0.7}
                  max={1.3}
                  step={0.05}
                  onChange={setRate}
                  hint="Pitch-true speed, no chipmunk"
                />
              </View>

              <View>
                <SectionLabel>Equalizer</SectionLabel>
                {/* No <select> on native: the row expands in place — the web's
                    chevron affordance kept, Custom behaves exactly the same. */}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPresetOpen((open) => !open)}
                  accessibilityLabel="Equalizer preset"
                  className="flex h-9 w-full flex-row items-center justify-between rounded-lg bg-surface-secondary/60 pl-2.5 pr-2.5 active:bg-surface-secondary"
                >
                  <Text className="font-medium text-foreground">{eqPreset}</Text>
                  <Icon
                    name="chevron-right"
                    aria-hidden
                    className={cn(
                      "size-3.5 text-muted",
                      presetOpen ? "rotate-90" : "rotate-90 opacity-60"
                    )}
                    strokeWidth={2}
                  />
                </Pressable>
                {presetOpen ? (
                  <ScrollView
                    className="max-h-56 rounded-lg border border-dock-line bg-dock"
                    nestedScrollEnabled
                  >
                    <PresetRow
                      label="Custom"
                      selected={eqPreset === "Custom"}
                      onPress={() => {
                        applyCustomPreset();
                        setPresetOpen(false);
                      }}
                    />
                    {EQ_PRESETS.map((preset) => (
                      <PresetRow
                        key={preset.label}
                        label={preset.label}
                        selected={eqPreset === preset.label}
                        onPress={() => {
                          choosePreset(preset);
                          setPresetOpen(false);
                        }}
                      />
                    ))}
                  </ScrollView>
                ) : null}
              </View>

              <View>
                <SectionLabel>Space</SectionLabel>
                <View className="flex-row flex-wrap gap-1">
                  {SPATIAL_MODES.map((mode) => (
                    <Chip
                      key={mode.value}
                      active={spatialMode === mode.value}
                      label={mode.hint}
                      onPress={() => setSpatialMode(mode.value as SpatialMode)}
                    >
                      {mode.label}
                    </Chip>
                  ))}
                </View>
              </View>
            </View>
          ) : null}
        </ScrollView>
      ) : (
        <View className="flex-1" />
      )}

      {/* Heavy preset hearing-safety dialog (web's inline dock copy, verbatim). */}
      <ConfirmDialog
        open={heavyPending !== null}
        title={`${heavyPending ?? ""} — ear check`}
        description="Heavy-duty profiles push big speaker stacks hard. Keep the volume as loud as it needs to be — no louder."
        confirmLabel="Enable"
        destructive
        onCancel={() => setHeavyPending(null)}
        onConfirm={() => {
          applyPreset(EQ_PRESETS.find((preset) => preset.label === heavyPending) ?? EQ_PRESETS[0]);
          setHeavyPending(null);
        }}
      />

      {/* Footer — what is playing, plus the theme switch. */}
      <View
        className={cn(
          "flex-none border-t border-dock-line",
          wide ? "px-2.5 py-2.5" : "flex flex-col items-center gap-1 px-2 py-2"
        )}
      >
        {wide ? (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => setNowPlayingOpen(!nowPlayingOpen)}
              accessibilityState={{ selected: nowPlayingOpen }}
              accessibilityLabel={current ? `Now playing: ${current.title}` : "Now playing panel"}
              className="flex w-full flex-row items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors active:bg-dock-hover"
            >
              <View className="relative size-8 flex-none items-center justify-center overflow-hidden rounded-md bg-surface">
                <Icon name="music" className="size-3.5 text-faint-foreground" aria-hidden />
                {current?.image ? (
                  <Image
                    source={{ uri: current.image }}
                    className="absolute inset-0 size-full"
                    resizeMode="cover"
                  />
                ) : null}
                {playing ? (
                  <View aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />
                ) : null}
              </View>
              <View className="min-w-0 flex-1">
                <Text
                  numberOfLines={1}
                  className="block truncate text-[12px] font-semibold leading-tight text-foreground"
                >
                  {current ? current.title : "Nothing queued"}
                </Text>
                <Text
                  numberOfLines={1}
                  className="mt-1 block truncate text-[10px] font-medium leading-none text-faint-foreground"
                >
                  {current
                    ? `${playing ? "Playing" : "Paused"} · ${current.artist}`
                    : "Pick a track to begin"}
                </Text>
              </View>
              {current && playing ? <EqBars className="flex-none" /> : null}
            </Pressable>

            <View className="mt-1 flex-row items-center justify-between gap-1 px-0.5">
              {authStatus === "loading" ? (
                <View aria-hidden className="h-9" />
              ) : authStatus === "authenticated" && user ? (
                <View className="flex min-w-0 flex-row items-center gap-1">
                  <Text className="size-7 flex-none items-center justify-center rounded-full bg-accent-soft text-[10px] font-bold uppercase text-brand">
                    {accountInitial}
                  </Text>
                  <Text
                    numberOfLines={1}
                    className="min-w-0 max-w-[7.5rem] truncate text-[11px] font-medium text-muted"
                  >
                    {accountName}
                  </Text>
                  <DockIcon label="Sign out" onClick={() => void logout()}>
                    <Icon name="log-out" className="size-4" strokeWidth={1.9} />
                  </DockIcon>
                </View>
              ) : (
                <Link
                  href="/login"
                  className="flex h-9 flex-row items-center gap-2.5 rounded-lg px-2.5"
                >
                  <View className="flex-row items-center gap-2.5">
                    <Icon name="user" className="size-4 text-muted" strokeWidth={1.9} />
                    <Text className="text-[12px] font-medium text-muted active:text-foreground">
                      Sign in
                    </Text>
                  </View>
                </Link>
              )}
              {/* canInstall dock button: PWA-only, removed (convention #18). */}
              <View className="flex flex-row flex-none items-center gap-1">
                <DockIcon label={themeLabel} onClick={toggle}>
                  <Icon
                    name={resolved === "dark" ? "sun" : "moon"}
                    className="size-4"
                    strokeWidth={1.9}
                  />
                </DockIcon>
              </View>
            </View>
          </>
        ) : (
          <>
            {current?.image ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setNowPlayingOpen(!nowPlayingOpen)}
                accessibilityState={{ selected: nowPlayingOpen }}
                accessibilityLabel="Now playing panel"
                className="relative size-9 overflow-hidden rounded-lg bg-surface active:scale-95"
              >
                <Image source={{ uri: current.image }} className="size-full" resizeMode="cover" />
                {playing ? (
                  <View aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />
                ) : null}
              </Pressable>
            ) : null}
            {authStatus === "authenticated" && user ? (
              <View className="flex flex-col items-center gap-1">
                <Text className="size-9 items-center justify-center rounded-full bg-accent-soft text-[11px] font-bold uppercase text-brand">
                  {accountInitial}
                </Text>
                <DockIcon label="Sign out" onClick={() => void logout()}>
                  <Icon name="log-out" className="size-4" strokeWidth={1.9} />
                </DockIcon>
              </View>
            ) : authStatus === "anonymous" ? (
              <Link
                href="/login"
                accessibilityLabel="Sign in"
                className="size-9 items-center justify-center rounded-lg"
              >
                <Icon name="user" className="size-4 text-muted" strokeWidth={1.9} />
              </Link>
            ) : null}
            {/* canInstall dock button: PWA-only, removed (convention #18). */}
            <DockIcon label={themeLabel} onClick={toggle}>
              <Icon
                name={resolved === "dark" ? "sun" : "moon"}
                className="size-4"
                strokeWidth={1.9}
              />
            </DockIcon>
          </>
        )}
      </View>
    </>
  );
}

/**
 * The drawer the web mounted inside a <dialog> with an AnimatePresence slide:
 * same spring (stiffness 420, damping 40), same backdrop, kept mounted so the
 * exit runs — `mobileNavOpen` flips the shared value; a closed drawer is
 * invisible and untouchable, exactly like the web after its 260 ms DRAWER_MS.
 */
export function SideBar({
  onBrowse,
  onRegions,
  onLibraryList,
}: {
  onBrowse?: () => void;
  onRegions?: () => void;
  onLibraryList?: () => void;
}) {
  const { mobileNavOpen, setMobileNavOpen } = useMusicPlayer();
  const insets = useSafeAreaInsets();

  /* The web's M-key dock toggle is dropped (no keyboard); setSidebarWide
   * survives through the header control. matchMedia resize-close: the drawer
   * only exists here, so it never needs closing on a desktop resize. */

  const progress = useSharedValue(0);
  useEffect(() => {
    // Same transition the web handed framer-motion.
    progress.value = withSpring(mobileNavOpen ? 1 : 0, { stiffness: 420, damping: 40 });
  }, [mobileNavOpen, progress]);

  const panelWidth = useMemo(() => {
    const screen = Dimensions.get("window").width;
    return Math.min(19.5 * 16, screen * 0.86); // w-[min(19.5rem,86vw)]
  }, []);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (progress.value - 1) * panelWidth }],
  }));

  return (
    <View
      pointerEvents={mobileNavOpen ? "auto" : "none"}
      accessibilityViewIsModal={mobileNavOpen}
      className="fixed inset-0 z-50"
    >
      {/* Backdrop — backdrop:bg-black/60 */}
      <Animated.View className="absolute inset-0 bg-black/60" style={backdropStyle} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close the dock"
        onPress={() => setMobileNavOpen(false)}
        className="absolute inset-0"
      />
      <Animated.View
        accessibilityLabel="ZYRAVA dock"
        className="absolute inset-y-0 left-0 flex-col border-r border-dock-line bg-dock shadow-pop"
        style={[{ width: panelWidth }, panelStyle]}
      >
        <View
          className="min-h-0 flex-1 flex-col"
          style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
        >
          <DockBody
            wide
            mobile
            onBrowse={onBrowse}
            onRegions={onRegions}
            onLibraryList={onLibraryList}
          />
        </View>
      </Animated.View>
    </View>
  );
}

/** One cell of the session grid — label, figure, optional footnote. */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View className="w-1/2 bg-dock px-3 py-2.5">
      <Text className="text-[9px] font-semibold uppercase leading-none tracking-[0.12em] text-faint-foreground">
        {label}
      </Text>
      <Text className="mt-1.5 text-[15px] font-semibold leading-none tracking-tight text-foreground tabular-nums">
        {value}
      </Text>
      {hint ? (
        <Text
          numberOfLines={1}
          className="mt-1 truncate text-[10px] font-medium leading-none text-faint-foreground"
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** A labelled range fader with its live readout. */
function Fader({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  hint?: string;
}) {
  return (
    <View>
      <View className="flex-row items-baseline justify-between gap-2">
        <Text className="text-[12px] font-medium text-muted">{label}</Text>
        <Text className="text-[11px] font-semibold tabular-nums text-foreground">{display}</Text>
      </View>
      <Slider
        value={[value]}
        minValue={min}
        maxValue={max}
        step={step}
        aria-label={label}
        onChange={(values) => onChange(sliderValue(values))}
        className="mt-2"
      >
        <Slider.Track className="h-1.5 rounded-full">
          <Slider.Fill className="rounded-full" />
          <Slider.Thumb className="size-3.5" />
        </Slider.Track>
      </Slider>
      {hint ? (
        <Text className="mt-1.5 text-[10px] leading-relaxed text-faint-foreground">{hint}</Text>
      ) : null}
    </View>
  );
}

/** Compact pill for the space picker. */
function Chip({
  active,
  onPress,
  label,
  children,
}: {
  active: boolean;
  onPress: () => void;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={cn(
        "min-h-7 rounded-full px-2.5 items-center justify-center",
        active ? "bg-accent" : "bg-surface-secondary/50"
      )}
    >
      <Text
        className={cn(
          "text-[11px] font-semibold",
          active ? "text-accent-foreground" : "text-muted"
        )}
      >
        {children}
      </Text>
    </Pressable>
  );
}

/** One option line in the inline EQ-preset list. */
function PresetRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      accessibilityState={{ selected }}
      className={cn(
        "flex-row items-center justify-between border-b border-dock-line px-2.5 py-2 last:border-b-0",
        selected ? "bg-dock-active" : "active:bg-dock-hover"
      )}
    >
      <Text className={cn("text-[12px] font-medium", selected ? "text-foreground" : "text-muted")}>
        {label}
      </Text>
      {selected ? <Icon name="check" className="size-3.5 text-brand" strokeWidth={2.4} /> : null}
    </Pressable>
  );
}
