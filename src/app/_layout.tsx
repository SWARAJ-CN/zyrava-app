import { NotificationLibraryControls } from "@/components/providers/NotificationLibraryControls";
import { CustomizationProvider } from "@/components/providers/CustomizationProvider";
import "react-native-reanimated";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "@expo-google-fonts/inter";
import * as SplashScreen from "expo-splash-screen";
import { Uniwind } from "uniwind";
import { HeroUINativeProvider, useThemeColor } from "heroui-native";
import { Stack } from "expo-router";
import { Appearance } from "react-native";

import { INTER_FONTS } from "@/lib/global-font";
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
import { AuthLoadingScreen } from "@/components/auth/AuthLoadingScreen";

export { AppErrorScreen as ErrorBoundary } from "@/components/AppErrorScreen";

/* Hold the native splash only until the branded React loading screen lays out. */
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

// Match the PWA's dark first paint while persisted preferences are loading.
Uniwind.setTheme("dark");

function hideNativeSplash() {
  void SplashScreen.hideAsync().catch(() => undefined);
}

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

function RootNavigator() {
  const backgroundColor = useThemeColor("background");
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor } }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(app)" />
    </Stack>
  );
}

export default function RootLayout(): JSX.Element | null {
  const [fontsLoaded, fontError] = useFonts(INTER_FONTS);
  const [ready, setReady] = useState(false);
  const [fontsTimedOut, setFontsTimedOut] = useState(false);

  useEffect(() => {
    if (fontsLoaded || fontError) return;
    const timer = setTimeout(() => setFontsTimedOut(true), 8000);
    return () => clearTimeout(timer);
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    let alive = true;
    // Boot must never hang on storage: worst case, the app runs from the
    // empty in-memory cache and persistence simply no-ops.
    void hydrateStorage()
      .then(() => {
        if (!alive) return;
        prePaintTheme();
        setReady(true);
      })
      .catch(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Paint the branded PWA loader immediately. Font errors must not strand the
  // app on a native splash forever; the OS font is a usable fallback.
  if ((!fontsLoaded && !fontError && !fontsTimedOut) || !ready) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }} onLayout={hideNativeSplash}>
        <SafeAreaProvider>
          <AuthLoadingScreen allowWake={false} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  /* The provider tree mirrors the web `app/layout.tsx` order exactly:
     I18n > Pwa > VisitBeacon/IdleNotifier > Theme > Auth > GuestLock > Toast
     > Community > Taste > Offline > MusicPlayer > Library > Guard > Chrome. */
  const initialLocale = readRequestLocale();

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={hideNativeSplash}>
      <SafeAreaProvider>
        <HeroUINativeProvider
          config={{
            /* The web raises bottom toast regions above the player bar
               (--toast-clearance); insets do the same natively. */
            toast: { insets: { bottom: 96 } },
            devInfo: { stylingPrinciples: false },
          }}
        >
          <I18nProvider initialLocale={initialLocale}>
            <PwaProvider>
              <VisitBeacon />
              <IdleNotifier />
              <ThemeProvider>
                <AuthProvider>
                  <CustomizationProvider>
                    <GuestLockProvider>
                      <ToastProvider>
                        <CommunityProvider>
                          <TasteProvider>
                            <OfflineProvider>
                              <MusicPlayerProvider>
                                <LibraryProvider>
                                  <NotificationLibraryControls />
                                  <PlaybackSessionGuard />
                                  {/* AppChrome lives in (app)/_layout, so the shell
                                    paints over every music screen without a second
                                    copy on the account routes — the web's root-level
                                    mount, expressed through the route groups. */}
                                  <AuthGate>
                                    <RootNavigator />
                                  </AuthGate>
                                  <ThemedStatusBar />
                                </LibraryProvider>
                              </MusicPlayerProvider>
                            </OfflineProvider>
                          </TasteProvider>
                        </CommunityProvider>
                      </ToastProvider>
                    </GuestLockProvider>
                  </CustomizationProvider>
                </AuthProvider>
              </ThemeProvider>
            </PwaProvider>
          </I18nProvider>
        </HeroUINativeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
