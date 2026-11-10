import Constants from "expo-constants";

function raw(name: string): string | undefined {
  const fromExtra = (Constants.expoConfig?.extra as Record<string, string> | undefined)?.[name];
  const fromProcess = (process.env as Record<string, string | undefined>)[name];
  return fromProcess ?? fromExtra ?? undefined;
}

/**
 * Account API origin. The web app proxies `/api/auth|library|community|visits`
 * through next.config rewrites; the mobile app resolves them against this
 * origin directly (paths stay identical).
 */
export const API_URL = (raw("EXPO_PUBLIC_API_URL") ?? "http://localhost:5000").replace(/\/+$/, "");

/**
 * Catalogue mirrors, comma-separated, tried in order — the same contract as
 * the web's server-side MUSIC_API. On device there is no CORS, so the app
 * talks to the mirrors directly instead of through /api/music/*.
 */
export const MUSIC_API_BASES = (raw("EXPO_PUBLIC_MUSIC_API") ?? "https://saavn.sumit.co/api")
  .split(",")
  .map((value) => value.trim().replace(/\/+$/, ""))
  .filter(Boolean);

/**
 * Optional hosted copy of the web app's music route handlers
 * (`/api/music/search|playlists|lyrics`). When set (EXPO_PUBLIC_WEB_BASE_URL),
 * the app prefers it — exactly the URLs the browser version used — so the
 * server-side caching and lyric circuit breakers keep working unchanged.
 */
export const WEB_BASE_URL = (raw("EXPO_PUBLIC_WEB_BASE_URL") ?? "").replace(/\/+$/, "");
