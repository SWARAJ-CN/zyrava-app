import { useState, type ReactNode } from "react";
import { Image, Pressable, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { Icon } from "@/components/ui/icons";
import { useLibrary } from "@/components/providers/LibraryProvider";
import { useMusicPlayer } from "@/components/providers/MusicPlayerProvider";
import { useGuestLock } from "@/components/providers/GuestLockProvider";
import { useOffline } from "@/components/providers/OfflineProvider";
import { Waveform } from "@/components/features/music/Waveform";
import { EqBars } from "@/components/features/music/EqBars";
import { cn } from "@/lib/cn";
import type { Song } from "@/lib/saavn";

/* Platform notes for this port (they repeat at each use):
 *  • next/image → react-native <Image source={{uri}}> — IMAGE_SIZES semantics
 *    (the browser picked 44/72/112px variants) collapse to one rule: the
 *    rendered box scales with `resizeMode="cover"`, exactly like `object-cover`.
 *  • `hover:` → `active:` press states; the `group-hover` index↔play swap
 *    becomes a per-row pressed flag (a finger is the only pointer here).
 *  • `hidden sm:block` / `hidden lg:block` breakpoint gates are kept verbatim;
 *    where the native engine ignores them the wide layout simply always shows
 *    the column, which is what the web does from `sm`/`lg` up. */

function formatSeconds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** The round icon button every row action is built from. */
const ROW_ACTION =
  "size-8 flex-none items-center justify-center rounded-full text-muted transition-colors active:bg-surface-secondary active:text-foreground";

/**
 * How much of a song has reached the device so far. The download reports
 * bytes, so the arc is the only honest reading of a save in progress.
 * Inline SVG → react-native-svg with the same dash maths; the 150 ms
 * stroke-dashoffset glide rides the tick-driven re-render instead.
 */
function SaveRing({ value }: { value: number }) {
  const rawSeparator = useCSSVariable("var(--separator)");
  const rawAccent = useCSSVariable("var(--accent)");
  const separator = typeof rawSeparator === "string" && rawSeparator ? rawSeparator : "#3a3344";
  const accent = typeof rawAccent === "string" && rawAccent ? rawAccent : "#10b981";
  const radius = 8;
  const ring = 2 * Math.PI * radius;
  const share = Math.min(1, Math.max(0, value));
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no">
      <Svg
        width={20}
        height={20}
        viewBox="0 0 20 20"
        style={{ transform: [{ rotate: "-90deg" }] }}
      >
      <Circle cx={10} cy={10} r={radius} fill="none" strokeWidth={2} stroke={separator} />
      <Circle
        cx={10}
        cy={10}
        r={radius}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        stroke={accent}
        strokeDasharray={`${ring}`}
        strokeDashoffset={ring * (1 - share)}
      />
      </Svg>
    </View>
  );
}

/** Column captions for the table variant — sits directly above <SongRows table>. */
export function SongTableHead({ album = true }: { album?: boolean }) {
  return (
    <View className="flex-row items-center gap-3 border-b border-separator px-2 pb-2 pt-1">
      <Text className="w-6 flex-none text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">
        #
      </Text>
      <Text className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">
        Title
      </Text>
      {album ? (
        <Text className="hidden min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-foreground lg:block">
          Album
        </Text>
      ) : null}
      <View
        className="w-[7rem] flex-none flex-row items-center justify-end"
        accessibilityLabel="Duration"
      >
        <Icon name="clock" className="inline-block size-3.5 text-faint-foreground" />
      </View>
    </View>
  );
}

/**
 * Puts a copy of the track on this device, or takes it back off. Every list
 * offers it, so it lives beside the rows instead of inside one view.
 */
export function SaveToDevice({ song }: { song: Song }) {
  const { savedIds, progress, save, removeSaved } = useOffline();
  const { requireAuth } = useGuestLock();
  const saved = savedIds.has(song.id);
  const busy = progress[song.id];
  const share = busy && busy.total > 0 ? busy.loaded / busy.total : 0;
  const percent = Math.min(100, Math.round(share * 100));

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        // Guest gating keeps the web's requireAuth("tab") semantics exactly.
        if (!requireAuth("tab")) return;
        if (saved) void removeSaved(song.id);
        else void save(song);
      }}
      accessibilityState={{ selected: saved }}
      accessibilityLabel={
        busy
          ? busy.total > 0
            ? `Saving ${song.title} — ${percent}%`
            : `Saving ${song.title}`
          : saved
            ? `Take ${song.title} off this device`
            : `Save ${song.title} on this device`
      }
      className={cn(ROW_ACTION, (saved || busy) && "text-brand")}
    >
      {busy ? (
        busy.total > 0 ? (
          <SaveRing value={share} />
        ) : (
          <Icon name="loader" className="size-4 motion-safe:animate-spin" />
        )
      ) : (
        <Icon name="download" className="size-4" />
      )}
    </Pressable>
  );
}

/** One action cluster: export a copy, or like + add + save. */
function RowActions({ song, device }: { song: Song; device: boolean }) {
  const { isLiked, toggleLike, openPicker } = useLibrary();
  const { exportCopy } = useOffline();

  /* Rows of device audio: the copy is already here, so the button hands
     it back out as a file instead of saving it again. */
  if (device) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => void exportCopy(song.id)}
        accessibilityLabel={`Export a copy of ${song.title}`}
        className={ROW_ACTION}
      >
        <Icon name="download" className="size-4" />
      </Pressable>
    );
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => toggleLike(song)}
        accessibilityState={{ selected: isLiked(song) }}
        accessibilityLabel={
          isLiked(song) ? `Remove ${song.title} from Liked songs` : `Like ${song.title}`
        }
        className={ROW_ACTION}
      >
        <Icon name="heart" className={cn("size-4", isLiked(song) && "fill-danger text-danger")} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => openPicker(song)}
        accessibilityLabel={`Add ${song.title} to a playlist`}
        className={ROW_ACTION}
      >
        <Icon name="plus" className="size-4" />
      </Pressable>
      <SaveToDevice song={song} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Shared track row for the Liked and Playlist home tabs.
 *
 * `table` switches on the Spotify presentation — numbered rows whose index
 * becomes a play button on hover (press on native), an album column, and the
 * current track marked in the brand colour. Without it the rows stay exactly
 * as the compact lists render them today. Every row action shows without the
 * pointer, so a touch device reaches them the same way a desktop does.
 *
 * `device` marks a list of audio that already lives here — the saved copies
 * and imported files. Those rows have nothing to save again, and liking or
 * filing one would write a row another device cannot resolve, so the account
 * actions step aside for a single "take it off" button.
 * ------------------------------------------------------------------ */
export function SongRows({
  songs,
  label,
  onRemove,
  table = false,
  device = false,
  album = true,
}: {
  songs: Song[];
  label: string;
  onRemove?: (song: Song) => void;
  table?: boolean;
  device?: boolean;
  /** Keep in step with <SongTableHead album> or the columns drift apart. */
  album?: boolean;
}) {
  const { startQueue, current, playing, togglePlay, visualizerReady, getAnalyser } =
    useMusicPlayer();

  /** Live bars, with the animated mimic when the analyser is kept away.
   *  The web's tone class became a real colour: "#ffffff" over artwork,
   *  var(--accent) everywhere else (Waveform/EqBars resolve currentColor). */
  const renderWave = (className: string, tone: string): ReactNode => (
    <View className={cn("items-center justify-center", className)}>
      {visualizerReady ? (
        <Waveform
          getAnalyser={getAnalyser}
          active={playing}
          className="h-full w-full"
          color={tone === "text-white" ? "#ffffff" : undefined}
        />
      ) : (
        <EqBars color={tone === "text-white" ? "#ffffff" : undefined} />
      )}
    </View>
  );

  return (
    <View className={cn("flex-col", table ? "gap-0.5 pt-1" : "gap-0.5")}>
      {songs.map((song, index) => {
        const active = current?.id === song.id;
        const wave = renderWave;

        return (
          <View
            key={song.id}
            className={cn(
              "flex-row items-center transition-colors",
              table ? "gap-3 rounded-lg px-2 py-1.5" : "gap-1 rounded-lg px-2 py-1.5",
              table && active && "bg-accent-soft"
            )}
          >
            {table ? (
              <IndexCell
                song={song}
                index={index}
                songs={songs}
                label={label}
                active={active}
                playing={playing}
                togglePlay={togglePlay}
                startQueue={startQueue}
                wave={wave}
              />
            ) : null}

            <ArtAndTitle
              song={song}
              label={label}
              index={index}
              songs={songs}
              table={table}
              active={active}
              startQueue={startQueue}
            />

            {table && album ? (
              <Text
                numberOfLines={1}
                className="hidden min-w-0 flex-1 text-[11px] text-muted lg:block"
              >
                {song.album || "—"}
              </Text>
            ) : null}

            <Text
              className={cn(
                "flex-none text-[11px] tabular-nums text-muted",
                table ? "block" : "hidden sm:block"
              )}
            >
              {formatSeconds(song.duration)}
            </Text>

            <View className={cn("flex-row items-center", table ? "flex-none gap-1" : "gap-0")}>
              <RowActions song={song} device={device} />
              {onRemove ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onRemove(song)}
                  accessibilityLabel={`Remove ${song.title}`}
                  className="size-8 flex-none items-center justify-center rounded-full text-faint-foreground transition-colors active:bg-surface-secondary active:text-danger"
                >
                  <Icon name={table ? "trash" : "x"} className="size-4" />
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * The numbered cell whose index becomes a play/pause button while the row is
 * pressed (the web's `group-hover` swap), and shows live bars on the track
 * that is actually playing.
 */
function IndexCell({
  song,
  index,
  songs,
  label,
  active,
  playing,
  togglePlay,
  startQueue,
  wave,
}: {
  song: Song;
  index: number;
  songs: Song[];
  label: string;
  active: boolean;
  playing: boolean;
  togglePlay: () => void;
  startQueue: (list: Song[], label: string, position: number) => void;
  wave: (className: string, tone: string) => ReactNode;
}) {
  const [pressed, setPressed] = useState(false);

  return (
    <View className="w-6 flex-none items-center justify-center">
      {active && playing ? (
        <Pressable
          accessibilityRole="button"
          onPress={togglePlay}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          accessibilityLabel={`Pause ${song.title}`}
          className="size-4 flex-none items-center justify-center"
        >
          {pressed ? (
            <Icon name="pause" className="size-3.5 fill-current text-brand" />
          ) : (
            <View className="h-full w-full">{wave("h-full w-full", "text-brand")}</View>
          )}
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => (active ? togglePlay() : startQueue(songs, label, index))}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          accessibilityLabel={active ? `Resume ${song.title}` : `Play ${song.title}`}
          className="size-4 flex-none items-center justify-center"
        >
          {pressed ? (
            <Icon name="play" className="size-3.5 fill-current text-foreground" />
          ) : (
            <Text className={cn("text-xs tabular-nums", active ? "text-brand" : "text-muted")}>
              {index + 1}
            </Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

/** The clickable art + title block — identical to the web's big row button. */
function ArtAndTitle({
  song,
  label,
  index,
  songs,
  table,
  active,
  startQueue,
}: {
  song: Song;
  label: string;
  index: number;
  songs: Song[];
  table: boolean;
  active: boolean;
  startQueue: (list: Song[], label: string, position: number) => void;
}) {
  /** The web dims a translucent play badge over the cover on hover. */
  const [pressed, setPressed] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => startQueue(songs, label, index)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityLabel={`Play ${song.title} by ${song.artist}`}
      className="flex min-w-0 flex-1 flex-row items-center gap-3"
    >
      <View className="relative size-11 flex-none overflow-hidden rounded-lg bg-surface-muted">
        {song.image ? (
          <Image
            source={{ uri: song.image }}
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
          />
        ) : (
          <Icon name="music" className="m-auto size-4 text-faint-foreground" />
        )}
        {!table ? (
          <View
            className={cn(
              "absolute inset-0 items-center justify-center bg-black/45 transition-opacity",
              pressed ? "opacity-100" : "opacity-0"
            )}
          >
            <Icon name="play" className="size-3.5 fill-white text-white" />
          </View>
        ) : null}
      </View>
      <View className="min-w-0 flex-1">
        <Text
          numberOfLines={1}
          className={cn(
            "block truncate text-sm font-semibold",
            active ? "text-brand" : "text-foreground"
          )}
        >
          {song.title}
        </Text>
        <Text numberOfLines={1} className="block truncate text-[11px] text-muted">
          {song.artist}
        </Text>
      </View>
    </Pressable>
  );
}
