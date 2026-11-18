/**
 * The Expo Go playback backend.
 *
 * `react-native-audio-api` needs its own native module, which Expo Go's
 * bundle cannot carry (it only ships the standard SDK modules). `expo-audio`
 * IS a standard SDK module — present in Expo Go — so it runs the transport:
 * load, play/pause, seek, volume, mute, tempo, position ticks and track-end.
 *
 * This is the unfiltered fallback if the foreground Web Audio host cannot
 * start or decode a track. The effects host owns normal Expo Go playback,
 * including Flat EQ, so selecting a preset never replaces the player.
 * The FX rack and native analyser still need the installed audio engine.
 *
 * The surface mirrors the native `<Audio>` tag's handle (play/pause/
 * seekToTime/setVolume/setMuted/setPlaybackRate) and its event props, so the
 * provider's queue, watchdog, recovery and taste logic run unchanged on
 * either backend.
 */
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioMetadata,
} from "expo-audio";
import Constants from "expo-constants";
import { isRunningInExpoGo } from "expo";

// Expo Go runs its own native manifest, not app.json's config plugins. Calling
// setActiveForLockScreen there logs a native service-binding error (it does not
// throw into JS), so try/catch cannot protect playback from that error overlay.
// Check Expo's native ExpoGo module as well as the manifest/runtime constants.
// A missing or misleading executionEnvironment must never enable the service.
const supportsBackgroundPlayback =
  !isRunningInExpoGo() &&
  Constants.appOwnership !== "expo" &&
  (Constants.executionEnvironment === "bare" || Constants.executionEnvironment === "standalone");

/** The same contract the native `<Audio>` tag exposes through its ref. */
export interface AudioTransportHandle {
  play: () => void;
  pause: () => void;
  seekToTime: (seconds: number) => void | Promise<void>;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  setPlaybackRate: (playbackRate: number) => void;
}

/** Events, with the same meaning as the tag's on* props. */
export interface AudioTransportCallbacks {
  onBufferingChange?: (buffering: boolean) => void;
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
  metadata?: AudioMetadata;
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
let modeConfiguration: Promise<void> | null = null;
export async function configureGoAudioMode(): Promise<void> {
  if (modeConfigured) return;
  if (!modeConfiguration)
    modeConfiguration = Promise.resolve()
      .then(() =>
        setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: supportsBackgroundPlayback,
          // Exclusive focus: other apps pause; their users resume their own.
          interruptionMode: "doNotMix",
        })
      )
      .then(() => {
        modeConfigured = true;
      })
      .catch(() => {
        /* Retry on the next track if the device temporarily rejects audio focus. */
      })
      .finally(() => {
        modeConfiguration = null;
      });
  await modeConfiguration;
}

function failedTransport(error: unknown, callbacks: AudioTransportCallbacks): AudioTransport {
  let disposed = false;
  // Let the provider finish installing this transport before reporting failure.
  void Promise.resolve().then(() => {
    if (!disposed) callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  });
  const noop = () => {};
  return {
    handle: {
      play: noop,
      pause: noop,
      seekToTime: noop,
      setVolume: noop,
      setMuted: noop,
      setPlaybackRate: noop,
    },
    dispose: () => {
      disposed = true;
    },
  };
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
  let player: AudioPlayer;
  try {
    player = createAudioPlayer(source, { updateInterval: 250 });
  } catch (error) {
    return failedTransport(error, callbacks);
  }
  try {
    player.volume = Math.min(1, Math.max(0, initial.volume));
    player.muted = initial.muted;
    if (initial.rate !== 1) player.setPlaybackRate(initial.rate, "high");
  } catch (error) {
    try {
      player.remove();
    } catch {
      /* release may already have happened natively */
    }
    return failedTransport(error, callbacks);
  }

  let loaded = false;
  let ended = false;
  let disposed = false;
  let wasPlaying = false;
  let lockScreenActive = false;
  let lockScreenUnavailable = false;
  const showLockScreen = () => {
    if (
      !supportsBackgroundPlayback ||
      !modeConfigured ||
      disposed ||
      lockScreenActive ||
      lockScreenUnavailable
    )
      return;
    try {
      player.setActiveForLockScreen(true, initial.metadata, {
        showSeekForward: true,
        showSeekBackward: true,
        seekForwardIntervalSeconds: 10,
        seekBackwardIntervalSeconds: 10,
      });
      lockScreenActive = true;
    } catch {
      // Older binaries may lack media controls; foreground audio still works.
      lockScreenUnavailable = true;
    }
  };
  void configureGoAudioMode().then(showLockScreen);

  let subscription: ReturnType<AudioPlayer["addListener"]>;
  try {
    subscription = player.addListener("playbackStatusUpdate", (status) => {
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
        wasPlaying = true;
        callbacks.onPlay();
      } else if (loaded && !status.isBuffering && !ended) {
        // didJustFinish is authoritative; a plain pause between ticks would
        // otherwise read as "ended" and skip the queue forward early.
        if (status.didJustFinish) {
          ended = true;
          wasPlaying = false;
          callbacks.onPause();
          callbacks.onEnded();
        } else if (wasPlaying) {
          wasPlaying = false;
          callbacks.onPause();
        }
      }
      // `playing` can remain true while buffering. Apply the buffer flag last,
      // after onLoad/onPlay have updated their playback mirrors.
      callbacks.onBufferingChange?.(status.isBuffering || !status.isLoaded);
    });
  } catch (error) {
    disposed = true;
    try {
      player.remove();
    } catch {
      /* already gone */
    }
    return failedTransport(error, callbacks);
  }

  const handle: AudioTransportHandle = {
    play() {
      if (disposed) return;
      try {
        showLockScreen();
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
      if (disposed || !Number.isFinite(seconds)) return;
      try {
        return player.seekTo(Math.max(0, seconds)).catch(() => undefined);
      } catch {
        /* a disposed native session cannot seek */
      }
    },
    setVolume(volume) {
      if (disposed) return;
      try {
        player.volume = Math.min(1, Math.max(0, volume));
      } catch {
        /* device session unavailable */
      }
    },
    setMuted(muted) {
      if (disposed) return;
      try {
        player.muted = muted;
      } catch {
        /* device session unavailable */
      }
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
      try {
        subscription.remove();
      } catch {
        /* still release the audio player */
      }
      if (lockScreenActive) {
        try {
          player.clearLockScreenControls();
        } catch {
          /* still release the player */
        }
      }
      try {
        player.pause();
      } catch {
        /* already stopped */
      }
      try {
        player.remove();
      } catch {
        /* already gone */
      }
    },
  };
}
