/**
 * Keeping the audio session awake — the device-side equivalent of the web
 * app's playback wake lock (PORTING_CONVENTIONS §17: `navigator.locks` is
 * dropped because native audio sessions already survive).
 *
 * On native, react-native-audio-api's `AudioManager` owns that job: the
 * session must be activated for playback to hold the screen awake and keep
 * the audio route, and the system interrupts it for calls or when another
 * app takes over. The player provider is the only consumer of these three
 * calls, so the whole wrapper stays deliberately tiny.
 */

import { getAudioEngine } from "./audio-engine";
import type { AudioEventSubscription } from "react-native-audio-api";

const engine = getAudioEngine();
const AudioManager = engine?.AudioManager;

export interface AudioInterruption {
  /** `began` when the system took the session, `ended` when it gave it back. */
  type: "began" | "ended";
  /** Whether the system expects the app to resume playback afterwards. */
  shouldResume: boolean;
}

export type AudioInterruptionListener = (interruption: AudioInterruption) => void;

/** Activates the app's audio session so playback survives the screen lock. */
export async function activateAudioSession(): Promise<boolean> {
  try {
    await AudioManager?.setAudioSessionActivity(true);
    return true;
  } catch {
    /* a session the system will not hand over — the caller plays regardless */
    return false;
  }
}

/** Releases it again once playback ends, so other apps get their audio back. */
export async function deactivateAudioSession(): Promise<boolean> {
  try {
    await AudioManager?.setAudioSessionActivity(false);
    return true;
  } catch {
    return false;
  }
}

const listeners = new Set<AudioInterruptionListener>();
let subscription: AudioEventSubscription | null = null;

/** Media-style focus: duck or pause for calls and other apps, recover after. */
function startObserving(): void {
  if (subscription) return;
  if (!AudioManager) return;
  AudioManager.observeAudioInterruptions("gain");
  subscription = AudioManager.addSystemEventListener("interruption", (event) => {
    for (const listener of [...listeners]) listener(event);
  });
}

function stopObserving(): void {
  if (listeners.size > 0 || !subscription) return;
  subscription.remove();
  subscription = null;
  AudioManager?.observeAudioInterruptions(null);
}

/**
 * Watches system interruptions while a listener is held. Returns the
 * function that stops watching, mirroring the app's other subscriptions.
 */
export function onAudioInterruption(listener: AudioInterruptionListener): () => void {
  listeners.add(listener);
  startObserving();
  return () => {
    listeners.delete(listener);
    stopObserving();
  };
}
