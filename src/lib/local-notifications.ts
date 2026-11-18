/* eslint-disable @typescript-eslint/no-require-imports -- Load native APIs only after capability checks. */
import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
import type * as Notifications from "expo-notifications";

type LocalNotifications = Pick<
  typeof Notifications,
  | "scheduleNotificationAsync"
  | "cancelScheduledNotificationAsync"
  | "getPermissionsAsync"
  | "requestPermissionsAsync"
  | "setNotificationChannelAsync"
>;
let cached: LocalNotifications | null | undefined;

/** Local reminders must never make the router depend on remote-push modules.
 * Load only the APIs we use, after checking the installed binary's capabilities.
 */
export function getLocalNotifications(): LocalNotifications | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS === "web") return cached;
  const required = ["ExpoNotificationScheduler", "ExpoNotificationPermissionsModule"];
  if (Platform.OS === "android") required.push("ExpoNotificationChannelManager");
  try {
    if (required.some((name) => !requireOptionalNativeModule(name))) return cached;
    const permissions =
      require("expo-notifications/build/NotificationPermissions") as typeof Notifications;
    cached = {
      getPermissionsAsync: permissions.getPermissionsAsync,
      requestPermissionsAsync: permissions.requestPermissionsAsync,
      scheduleNotificationAsync: require("expo-notifications/build/scheduleNotificationAsync")
        .scheduleNotificationAsync,
      cancelScheduledNotificationAsync:
        require("expo-notifications/build/cancelScheduledNotificationAsync")
          .cancelScheduledNotificationAsync,
      setNotificationChannelAsync: require("expo-notifications/build/setNotificationChannelAsync")
        .setNotificationChannelAsync,
    };
  } catch {
    // Older development binaries can expose only part of the notifications API.
    cached = null;
  }
  return cached;
}
