/**
 * Single point of access to `react-native-audio-api`.
 *
 * The library instantiates its native module AT MODULE SCOPE and throws
 * `AudioApiError: Failed to install react-native-audio-api` when the native
 * side is absent (Expo Go, or any binary built before the module was linked).
 * A plain `import { Audio } from "react-native-audio-api"` therefore crashes
 * every module that (transitively) imports it — and expo-router then reports
 * each route as "missing the required default export".
 *
 * This shim requires the package inside a try/catch, so an app without the
 * native engine still boots. Playback itself never depends on this module:
 * when it is absent the player provider runs its Expo Go backend through
 * a foreground WebView EQ/Space graph, with `expo-audio` as a failure fallback.
 * The studio FX rack, native analyser and pads still require this engine.
 * Every runtime use MUST go through `getAudioEngine()`; direct imports are
 * allowed only as `import type { … }` (erased at compile time).
 */
import Constants from "expo-constants";

export type AudioEngine = typeof import("react-native-audio-api");

/** The audio path this binary can actually run. */
export type AudioBackend = "native-graph" | "expo-go";

let cached: AudioEngine | null | undefined;
let lastError: string | null = null;
let warned = false;

/**
 * Expo Go's execution environment — its bundle ships only the standard SDK
 * modules, so the custom engine will never be present there. Detected once
 * via expo-constants instead of a global sniff that no runtime guarantees.
 */
export const isExpoGo = Constants.executionEnvironment === "storeClient";

export function getAudioEngine(): AudioEngine | null {
  if (cached === undefined) {
    try {
      const candidate = require("react-native-audio-api") as AudioEngine | undefined; // eslint-disable-line @typescript-eslint/no-require-imports
      /*
       * A require that loads but cannot construct its context (the
       * "getDevicePreferredSampleRate of null" failure mode: the JS side
       * resolved while the native module never registered) is as useless as
       * a missing module — both must read as "no engine", never as a
       * half-usable one that later calls die on.
       */
      const usable =
        !!candidate &&
        typeof candidate.AudioContext === "function" &&
        (typeof candidate.Audio === "function" ||
          (typeof candidate.Audio === "object" &&
            candidate.Audio !== null &&
            (candidate.Audio.$$typeof === Symbol.for("react.memo") ||
              candidate.Audio.$$typeof === Symbol.for("react.forward_ref"))));
      cached = usable ? candidate : null;
      if (usable) {
        lastError = null;
      } else {
        lastError = "react-native-audio-api loaded without its native engine";
      }
    } catch (error) {
      cached = null;
      lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    if (cached === null && !warned) {
      warned = true;
      // Exactly one line per launch, whatever asked for the engine.
      console.warn(`[zyrava] native audio engine unavailable — ${lastError}`);
    }
  }
  return cached;
}

/**
 * Why the native engine is absent, if it is — for one honest line in the
 * mixer console ("", or a short reason).
 */
export function audioEngineFailure(): string {
  if (cached === undefined) getAudioEngine();
  if (cached) return "";
  if (isExpoGo) return "Expo Go carries no custom native modules";
  return lastError ?? "unknown";
}

/** The playback backend this binary runs — decided once, stable for good. */
export function audioBackend(): AudioBackend {
  return getAudioEngine() ? "native-graph" : "expo-go";
}

/**
 * True when the studio-grade graph (EQ, FX rack, spatial modes, analyser,
 * DJ pads) exists in this binary. Playback, queueing, seek, tempo and the
 * mixer's *state* work everywhere; only these graph-backed stages need it.
 */
export const hasAdvancedAudio = getAudioEngine() !== null;

/** Only shown when NO audio backend exists at all (never in Expo Go). */
export const NO_ENGINE_MESSAGE =
  "No audio backend in this build — reinstall the ZYRAVA app (see README) to listen.";
