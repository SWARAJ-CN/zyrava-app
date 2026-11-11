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
 * native engine still boots: browsing, library, chat, lyrics and settings all
 * work, while the player degrades to a clear message instead of a crash wall.
 * Every runtime use MUST go through `getAudioEngine()`; direct imports are
 * allowed only as `import type { … }` (erased at compile time).
 */
export type AudioEngine = typeof import("react-native-audio-api");

let cached: AudioEngine | null | undefined;
let lastError: string | null = null;

export function getAudioEngine(): AudioEngine | null {
  if (cached === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      cached = require("react-native-audio-api") as AudioEngine;
      lastError = null;
    } catch (error) {
      cached = null;
      lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      // Surfaced so a missing engine on a real build is one logcat line from
      // a diagnosis instead of a guess between Expo Go and a native failure.
      console.warn(`[zyrava] audio engine unavailable — ${lastError}`);
    }
  }
  return cached;
}

/** Why the engine failed to load, if it did ("", "Expo Go", or the error). */
export function audioEngineFailure(): string {
  if (cached) return "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExpoGo = (globalThis as any).ExpoGo;
  if (ExpoGo != null) return "Expo Go — its bundle has no custom native modules.";
  return lastError ?? "unknown";
}

/** True when the real audio engine is linked into this binary. */
export const hasAudioEngine = getAudioEngine() !== null;

/** Shown in the player bar when playback is attempted without the engine. */
export const NO_ENGINE_MESSAGE =
  "This build has no audio engine — install the ZYRAVA dev build (see README) to listen.";
