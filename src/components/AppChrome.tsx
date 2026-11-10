import { useSegments } from "expo-router";
import { SideBar } from "@/components/features/music/SideBar";
import { MixerConsole } from "@/components/features/music/MixerConsole";
import { NowPlayingPanel } from "@/components/features/music/NowPlayingPanel";
import { ChatPanel } from "@/components/features/community/ChatPanel";
import { StickyPlayerBar } from "@/components/features/music/StickyPlayerBar";
import { useAuth } from "@/components/providers/AuthProvider";
import { useGuestLock } from "@/components/providers/GuestLockProvider";

const AUTH_ROUTES = new Set(["/login", "/register"]);

/** expo-router segments minus group folders — the web pathname's shape. */
function currentRoute(segments: string[]): string {
  const bare = segments.filter((segment) => !segment.startsWith("("));
  return bare.length ? `/${bare.join("/")}` : "/";
}

/**
 * The player shell belongs to the music app. It stays unmounted on the account
 * screens and while the session is still being restored, so the first paint is
 * never a half-drawn page. A guest gets the dock and the bar — the console is
 * the part they have not unlocked yet.
 */
export function AppChrome() {
  const segments = useSegments();
  const { status } = useAuth();
  const { isGuest } = useGuestLock();
  const route = currentRoute(segments);
  if (AUTH_ROUTES.has(route) || (status !== "authenticated" && !isGuest)) return null;
  /* On mobile the chrome overlays every (app) screen — including the home
     feed, which is the web's "/" with its own layout. Each mounted component
     hides itself until its open flag flips (drawer/console/chat/bar). */
  return (
    <>
      <SideBar />
      {isGuest ? null : <MixerConsole />}
      {/* InstallSheet is a PWA-only surface: the native app is already on the
          home screen (see PwaProvider), so nothing renders in its place. */}
      <NowPlayingPanel />
      <ChatPanel />
      <StickyPlayerBar />
    </>
  );
}
