import type { JSX } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";

import { AppChrome } from "@/components/AppChrome";

/**
 * The music app's shell stack. expo-router stands in for the web's single
 * page tree: `index` is the web home feed. The overlays the web mounted as
 * state-driven dialogs — SideBar drawer (mobileNavOpen), MixerConsole
 * (mixerOpen), ChatPanel (chatOpen), NowPlayingPanel (nowPlayingOpen) and the
 * StickyPlayerBar (queue active) — are mounted ONCE by AppChrome above the
 * stack; each panel hides itself until its provider flag flips, exactly like
 * the browser build. Playback keeps running underneath every navigation
 * because the chrome never unmounts.
 */
export default function AppLayout(): JSX.Element {
  return (
    <View className="flex-1">
      <Stack screenOptions={{ headerShown: false }} />
      <AppChrome />
    </View>
  );
}
