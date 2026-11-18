import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { getLocalNotifications } from "@/lib/local-notifications";
import { SchedulableTriggerInputTypes } from "expo-notifications/build/Notifications.types";
import { AndroidImportance } from "expo-notifications/build/NotificationChannelManager.types";
import { getItem, setItem } from "@/lib/store";

/** Inactivity before the first wake-up nudge. */
const FIRST_AFTER = 60 * 60_000;
/** The first two nudges come in 20 minutes apart. */
const EARLY_EVERY = 20 * 60_000;
/** From two hours of quiet on, one ping an hour is plenty. */
const LATE_EVERY = 60 * 60_000;
/** How often the idle clock is read. */
const TICK_EVERY = 30_000;

/** The wake-ups rotate, so a day of silence never reads as one drone. */
const MESSAGES = [
  { body: "The queue is ready when you are — pick up where you left off." },
  { body: "Your taste has moved on since this morning. Come hear what's next." },
  { body: "Still there? Your last played track is waiting on deck." },
  { body: "A new radio run is built from what you've been playing. Open ZYRAVA." },
];

/** One scheduled request at a time, replaced under this stable identifier —
 *  the stand-in for the web notification's `tag: "zyrava-idle"`. */
const IDLE_TAG = "zyrava-idle";

function messageSeed(): number {
  try {
    const stored = getItem("zyrava:idle-seed");
    const next = stored ? (Number(stored) + 1) % MESSAGES.length : 0;
    setItem("zyrava:idle-seed", String(next));
    return next;
  } catch {
    return Math.floor(Math.random() * MESSAGES.length);
  }
}

/**
 * Queues the next wake-up as a single scheduled local notification. The OS
 * delivers it even when the JS is frozen; the `icon`/`badge` the web pointed at
 * the PWA maskable icon are the app's own icon by default on native, and a tap
 * opens the app — the same "one tap reopens the player" the web's data.url did.
 */
async function push(body: string, at: number): Promise<void> {
  const Notifications = getLocalNotifications();
  if (!Notifications) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(IDLE_TAG).catch(() => undefined);
    await Notifications.scheduleNotificationAsync({
      identifier: IDLE_TAG,
      content: { title: "ZYRAVA", body, data: {} },
      trigger: {
        type: SchedulableTriggerInputTypes.DATE,
        ...(Platform.OS === "android" ? { channelId: IDLE_TAG } : {}),
        date: new Date(Math.max(at, Date.now() + 1_000)),
      },
    });
  } catch {
    /* notifications refused — the app above still speaks for itself */
  }
}

/**
 * The inactivity wake-up. Any gesture stands the clock back to zero; once the
 * app has gone quiet for an hour the microphone of the OS (the notification
 * shade) gets a nudge — the first two twenty minutes apart, then once an hour
 * from the two-hour mark on. Tapping one reopens the player.
 *
 * On the web the schedule ticked in a visible page; natively the schedule is
 * armed at the moment the app leaves the screen (AppState "background" — the
 * hidden-only rule the web checked with visibilityState), and the tick keeps
 * the clock honest while the app is still on screen.
 */
export function IdleNotifier() {
  const lastActivityRef = useRef(0);
  const lastNotifiedAtRef = useRef(0);

  useEffect(() => {
    const Notifications = getLocalNotifications();
    if (!Notifications) return;
    lastActivityRef.current = Date.now();

    /* Asking cold is a shot in the dark; the reader grants it once they have
       touched the app — on native, the first foreground/background gesture. */
    let asked = false;
    const ask = () => {
      if (asked) return;
      asked = true;
      void Notifications.getPermissionsAsync()
        .then(({ status }) => {
          if (status === "undetermined") return Notifications.requestPermissionsAsync();
        })
        .catch(() => undefined);
    };

    if (Platform.OS === "android") {
      // The channel that carries every zyrava-idle wake-up.
      void Notifications.setNotificationChannelAsync(IDLE_TAG, {
        name: "ZYRAVA",
        importance: AndroidImportance.DEFAULT,
      }).catch(() => undefined);
    }

    /** Arms the next nudge from the web's own pacing rules. */
    const arm = () => {
      const now = Date.now();
      const quiet = now - lastActivityRef.current;
      if (quiet < FIRST_AFTER) {
        lastNotifiedAtRef.current = 0;
        void push(MESSAGES[messageSeed()].body, lastActivityRef.current + FIRST_AFTER);
        return;
      }
      const sinceNotified = now - lastNotifiedAtRef.current;
      const gap = quiet < 2 * FIRST_AFTER ? EARLY_EVERY : LATE_EVERY;
      // First nudge of a quiet stretch ignores the gap; the rest pace off it.
      if (lastNotifiedAtRef.current && sinceNotified < gap) {
        void push(MESSAGES[messageSeed()].body, lastNotifiedAtRef.current + gap);
        return;
      }
      lastNotifiedAtRef.current = now;
      void push(MESSAGES[messageSeed()].body, now);
    };

    const appState = AppState.addEventListener("change", (next) => {
      ask(); // any gesture is a gesture the permission can ride on
      if (next === "background") {
        arm();
        return;
      }
      if (next === "active") {
        /* A visible app is a used app — the shade keeps its silence. */
        void Notifications.cancelScheduledNotificationAsync(IDLE_TAG).catch(() => undefined);
        lastActivityRef.current = Date.now();
        lastNotifiedAtRef.current = 0;
      }
    });

    const tick = setInterval(() => {
      if (AppState.currentState !== "background") {
        lastNotifiedAtRef.current = 0;
      }
    }, TICK_EVERY);

    return () => {
      clearInterval(tick);
      appState.remove();
    };
  }, []);

  return null;
}
