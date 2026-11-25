import { useEffect, useRef } from "react";
import { DeviceEventEmitter, Platform } from "react-native";
import { getAudioEngine } from "@/lib/audio-engine";
import { useAuth } from "./AuthProvider";
import { useLibrary } from "./LibraryProvider";
import { useMusicPlayer } from "./MusicPlayerProvider";

/** Android's custom media action uses the same authenticated library mutation as the heart in-app. */
export function NotificationLibraryControls() {
  const { user } = useAuth();
  const { current } = useMusicPlayer();
  const { isLiked, toggleLike } = useLibrary();
  const lastTap = useRef(0);
  const liked = current ? isLiked(current) : false;
  const notify = Platform.OS === "android" ? getAudioEngine()?.PlaybackNotificationManager : null;

  useEffect(() => {
    if (!notify || !current) return;
    // The pinned native extension reads these fields; older binaries ignore
    // them safely until rebuilt. All standard metadata stays owned by the player.
    const state = {
      zyravaSongId: current.id,
      zyravaLiked: liked,
      zyravaLikeEnabled: Boolean(user),
    };
    void notify.show(state as Parameters<typeof notify.show>[0]).catch(() => undefined);
  }, [notify, current, liked, user]);

  useEffect(() => {
    if (!notify || !current || !user) return;
    const subscription = DeviceEventEmitter.addListener("zyravaPlaybackLike", (event: unknown) => {
      if (
        !event ||
        typeof event !== "object" ||
        !("songId" in event) ||
        event.songId !== current.id
      )
        return;
      const now = Date.now();
      if (now - lastTap.current < 500) return;
      lastTap.current = now;
      toggleLike(current);
    });
    return () => subscription.remove();
  }, [notify, current, user, toggleLike]);
  return null;
}
