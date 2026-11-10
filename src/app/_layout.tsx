import "react-native-reanimated";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_900Black } from "@expo-google-fonts/inter";
import * as SplashScreen from "expo-splash-screen";
import { Uniwind } from "uniwind";
import { HeroUINativeProvider } from "heroui-native";
import { Stack } from "expo-router";
import { Appearance } from "react-native";

import "../global.css";
import { hydrateStorage, getItem } from "@/lib/store";
import { readRequestLocale } from "@/lib/i18n/server";
import { I18nProvider } from "@/components/providers/I18nProvider";
import { PwaProvider } from "@/components/providers/PwaProvider";
import { VisitBeacon } from "@/components/VisitBeacon";
import { IdleNotifier } from "@/components/providers/IdleNotifier";
import { ThemeProvider, useTheme } from "@/components/providers/ThemeProvider";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { GuestLockProvider } from "@/components/providers/GuestLockProvider";
import { ToastProvider } from "@/components/providers/ToastProvider";
import { CommunityProvider } from "@/components/providers/CommunityProvider";
import { TasteProvider } from "@/components/providers/TasteProvider";
import { OfflineProvider } from "@/components/providers/OfflineProvider";
import { MusicPlayerProvider } from "@/components/providers/MusicPlayerProvider";
import { LibraryProvider } from "@/components/providers/LibraryProvider";
import { PlaybackSessionGuard } from "@/components/providers/PlaybackSessionGuard";
import { AuthGate } from "@/components/auth/AuthGate";

/* Hold the native splash until storage is hydrated and Inter is live — the
   mobile mirror of the web's pre-paint theme script + font pipeline. */
void SplashScreen.preventAutoHideAsync();

/** Resolve `music-theme` ("light"|"dark"|"system") before first paint. */
function prePaintTheme(): void {
  const saved = getItem("music-theme");
  const mode = saved === "light" || saved === "dark" || saved === "system" ? saved : "dark";
  const resolved = mode === "system" ? (Appearance.getColorScheme() ?? "dark") : mode;
  Uniwind.setTheme(resolved);
}

function ThemedStatusBar(): JSX.Element {
  const { resolved } = useTheme();
  return <StatusBar style={resolved === "light" ? "dark" : "light"} />;
}

export default function RootLayout(): JSX.Element | null {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_900Black,
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void hydrateStorage().then(() => {
      prePaintTheme();
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (fontsLoaded && ready) void SplashScreen.hideAsync();
  }, [fontsLoaded, ready]);

  if (!fontsLoaded || !ready) return null;

  /* The provider tree mirrors the web `app/layout.tsx` order exactly:
     I18n > Pwa > VisitBeacon/IdleNotifier > Theme > Auth > GuestLock > Toast
     > Community > Taste > Offline > MusicPlayer > Library > Guard > Chrome. */
  const initialLocale = readRequestLocale();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <HeroUINativeProvider>
          <I18nProvider initialLocale={initialLocale}>
            <PwaProvider>
              <VisitBeacon />
              <IdleNotifier />
              <ThemeProvider>
                <AuthProvider>
                  <GuestLockProvider>
                    <ToastProvider>
                      <CommunityProvider>
                        <TasteProvider>
                          <OfflineProvider>
                            <MusicPlayerProvider>
                              <LibraryProvider>
                                <PlaybackSessionGuard />
                                {/* AppChrome lives in (app)/_layout, so the shell
                                    paints over every music screen without a second
                                    copy on the account routes — the web's root-level
                                    mount, expressed through the route groups. */}
                                <AuthGate>
                                  <Stack screenOptions={{ headerShown: false }}>
                                    <Stack.Screen name="(auth)" />
                                    <Stack.Screen name="(app)" />
                                  </Stack>
                                </AuthGate>
                                <ThemedStatusBar />
                              </LibraryProvider>
                            </MusicPlayerProvider>
                          </OfflineProvider>
                        </TasteProvider>
                      </CommunityProvider>
                    </ToastProvider>
                  </GuestLockProvider>
                </AuthProvider>
              </ThemeProvider>
            </PwaProvider>
          </I18nProvider>
        </HeroUINativeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
