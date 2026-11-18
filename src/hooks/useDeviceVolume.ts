import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, NativeModules, Platform } from "react-native";
import Constants from "expo-constants";
import type { VolumeResult } from "react-native-volume-manager";

type Manager = typeof import("react-native-volume-manager").VolumeManager;
function nativeManager(): Manager | null {
  if (
    Platform.OS === "web" ||
    Constants.executionEnvironment === "storeClient" ||
    !NativeModules.VolumeManager
  )
    return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("react-native-volume-manager") as typeof import("react-native-volume-manager"))
      .VolumeManager;
  } catch {
    return null;
  }
}
const manager = nativeManager();
const valid = (result: VolumeResult) =>
  (!result.type || result.type === "music") &&
  Number.isFinite(result.volume) &&
  result.volume >= 0 &&
  result.volume <= 1;

/** Read-only at startup; only a deliberate slider gesture changes phone volume. */
export function useDeviceVolume() {
  const [volume, setValue] = useState<number | null>(null);
  const alive = useRef(false);
  const revision = useRef(0);
  const pending = useRef<number | null>(null);
  const writing = useRef(false);
  useEffect(() => {
    if (!manager) return;
    alive.current = true;
    // The module initializes iOS with an ambient session. Keep music audible
    // with the silent switch on, matching the player's playback session.
    if (Platform.OS === "ios") void manager.setCategory("Playback", false).catch(() => {});
    let subscription: ReturnType<Manager["addVolumeListener"]> | undefined;
    const read = async () => {
      const at = revision.current;
      try {
        const result = await manager.getVolume();
        if (alive.current && revision.current === at && valid(result)) setValue(result.volume);
      } catch {
        /* unlinked/unsupported device: keep the app-volume fallback */
      }
    };
    try {
      subscription = manager.addVolumeListener((result) => {
        if (!alive.current || !valid(result)) return;
        revision.current++;
        setValue(result.volume);
      });
      void read();
    } catch {
      /* unavailable in this binary */
    }
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void read();
    });
    return () => {
      alive.current = false;
      pending.current = null;
      try {
        subscription?.remove();
      } catch {
        /* module already released */
      }
      appState.remove();
    };
  }, []);

  const setVolume = useCallback((value: number) => {
    if (!manager || !alive.current || !Number.isFinite(value)) return;
    const next = Math.max(0, Math.min(1, value));
    revision.current++;
    setValue(next);
    pending.current = next;
    if (writing.current) return;
    writing.current = true;
    void (async () => {
      try {
        while (alive.current && pending.current !== null) {
          const target = pending.current;
          pending.current = null;
          await manager.setVolume(target, { type: "music", playSound: false, showUI: false });
          // Keep draining if a gesture arrives while reading back a quantized value.
          const at = revision.current;
          const result = await manager.getVolume();
          if (alive.current && revision.current === at && pending.current === null && valid(result))
            setValue(result.volume);
        }
      } catch {
        pending.current = null;
        if (alive.current) setValue(null);
      } finally {
        writing.current = false;
      }
    })();
  }, []);
  return { volume, setVolume };
}
