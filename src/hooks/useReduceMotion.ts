import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

let reduced = false;
let generation = 0;
let subscription: ReturnType<typeof AccessibilityInfo.addEventListener> | null = null;
const listeners = new Set<() => void>();

function update(value: boolean) {
  if (reduced === value) return;
  reduced = value;
  for (const listener of listeners) listener();
}

/** One native accessibility subscription for all mounted buttons and controls. */
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!subscription) {
    const current = ++generation;
    subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      // A live event wins over an initial query still crossing the native bridge.
      generation++;
      update(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (generation === current) update(value);
      })
      .catch(() => undefined);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      subscription?.remove();
      subscription = null;
      generation++;
    }
  };
}

const getSnapshot = () => reduced;
const getServerSnapshot = () => false;

export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
