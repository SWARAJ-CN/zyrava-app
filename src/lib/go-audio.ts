/**
 * The Expo Go playback backend.
 *
 * `react-native-audio-api` needs its own native module, which Expo Go's
 * bundle cannot carry (it only ships the standard SDK modules). `expo-audio`
 * IS a standard SDK module — present in Expo Go — so it runs the transport:
 * load, play/pause, seek, volume, mute, tempo, position ticks and track-end.
 *
 * What it deliberately does NOT try to fake: the studio graph. EQ, the FX
 * rack, spatial modes, the analyser/visualisers and DJ pads need real audio
 * nodes; pretending otherwise would be dishonest audio. The provider keeps
 * every control rendered and simply leaves these stages inactive (see
 * MixerConsole's notice), while the dev build unlocks them again.
 *
 * The surface mirrors the native `<Audio>` tag's handle (play/pause/
 * seekToTime/setVolume/setMuted/setPlaybackRate) and its event props, so the
 * provider's queue, watchdog, recovery and taste logic run unchanged on
 * either backend.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

/** The same contract the native `<Audio>` tag exposes through its ref. */
export interface AudioTransportHandle {
  play: () => void;
  pause: () => void;
  seekToTime: (seconds: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  setPlaybackRate: (playbackRate: number) => void;
}

/** Events, with the same meaning as the tag's on* props. */
export interface AudioTransportCallbacks {
  /** The source is loaded and its duration is known. */
  onLoad: (duration: number) => void;
  onPlay: () => void;
  onPause: () => void;
  /** Playback reached the end of the track. */
  onEnded: () => void;
  /** The source cannot be played. */
  onError: (error: Error) => void;
  /** Position tick while playing. */
  onPositionChange: (time: number) => void;
}

export interface AudioTransportInitial {
  volume: number;
  muted: boolean;
  rate: number;
}

export interface AudioTransport {
  handle: AudioTransportHandle;
  /** Frees the underlying player. Call before replacing the source. */
  dispose: () => void;
}

/** Audio session once per launch, in place of the native AudioManager. */
let modeConfigured = false;
export async function configureGoAudioMode(): Promise<void> {
  if (modeConfigured) return;
  modeConfigured = true;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      // Exclusive focus: other apps pause; their users resume their own.
      interruptionMode: "doNotMix",
    });
  } catch {
    /* the session mode is a nicety — playback works without it */
  }
}

/**
 * Starts a player for `source` and reports through `callbacks` exactly like
 * the native tag. One player per call; the caller owns `dispose()`.
 */
export function createGoAudioTransport(
  source: string,
  callbacks: AudioTransportCallbacks,
  initial: AudioTransportInitial
): AudioTransport {
  void configureGoAudioMode();

  // 250 ms ticks: smooth seek bar, honest watchdog — same feel as native.
  const player: AudioPlayer = createAudioPlayer(source, { updateInterval: 250 });
  player.volume = Math.min(1, Math.max(0, initial.volume));
  player.muted = initial.muted;
  if (initial.rate !== 1) player.setPlaybackRate(initial.rate, "high");

  let loaded = false;
  let ended = false;
  let disposed = false;

  const subscription = player.addListener("playbackStatusUpdate", (status) => {
    if (disposed) return;
    if (status.isLoaded && !loaded && status.duration > 0) {
      loaded = true;
      callbacks.onLoad(status.duration);
    }
    if (status.currentTime > 0 || status.playing) {
      callbacks.onPositionChange(status.currentTime);
    }
    if (status.playing) {
      ended = false;
      callbacks.onPlay();
    } else if (loaded && !status.isBuffering && !ended) {
      // didJustFinish is authoritative; a plain pause between ticks would
      // otherwise read as "ended" and skip the queue forward early.
      if (status.didJustFinish) {
        ended = true;
        callbacks.onPause();
        callbacks.onEnded();
      } else {
        callbacks.onPause();
      }
    }
  });

  const handle: AudioTransportHandle = {
    play() {
      if (disposed) return;
      try {
        player.play();
      } catch (error) {
        callbacks.onError(error instanceof Error ? error : new Error(String(error)));
      }
    },
    pause() {
      if (disposed) return;
      try {
        player.pause();
      } catch {
        /* pausing a not-yet-loaded player is a no-op */
      }
    },
    seekToTime(seconds) {
      if (disposed) return;
      void player.seekTo(Math.max(0, seconds)).catch(() => undefined);
    },
    setVolume(volume) {
      if (disposed) return;
      player.volume = Math.min(1, Math.max(0, volume));
    },
    setMuted(muted) {
      if (disposed) return;
      player.muted = muted;
    },
    setPlaybackRate(rate) {
      if (disposed) return;
      try {
        // Android accepts 0.1–2.0; clamp to what both platforms honour.
        player.setPlaybackRate(Math.min(2, Math.max(0.1, rate)), "high");
      } catch {
        /* tempo is a nicety, never a crash */
      }
    },
  };

  return {
    handle,
    dispose() {
      if (disposed) return;
      disposed = true;
      subscription.remove();
      try {
        player.remove();
      } catch {
        /* already gone */
      }
    },
  };
}
