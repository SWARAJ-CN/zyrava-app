import Constants from "expo-constants";

function extra(name: string): string | undefined {
  const value = Constants.expoConfig?.extra?.[name];
  return typeof value === "string" ? value : undefined;
}

// Expo only embeds public variables referenced with literal property names.
// A dynamic process.env[name] works differently in Metro and release builds.
const accountApi = process.env.EXPO_PUBLIC_API_URL ?? extra("EXPO_PUBLIC_API_URL");
const musicApi = process.env.EXPO_PUBLIC_MUSIC_API ?? extra("EXPO_PUBLIC_MUSIC_API");
const webBase = process.env.EXPO_PUBLIC_WEB_BASE_URL ?? extra("EXPO_PUBLIC_WEB_BASE_URL");

/**
 * Account API origin. The web app proxies `/api/auth|library|community|visits`
 * through next.config rewrites; the mobile app resolves them against this
 * origin directly (paths stay identical).
 */
export const API_URL = (accountApi?.trim() || "https://zyrava-server.onrender.com").replace(
  /\/+$/,
  ""
);

/**
 * Catalogue mirrors, comma-separated, tried in order — the same contract as
 * the web's server-side MUSIC_API. On device there is no CORS, so the app
 * talks to the mirrors directly when no web origin is configured.
 */
export const MUSIC_API_BASES = (musicApi ?? "https://saavn.sumit.co/api")
  .split(",")
  .map((value) => value.trim().replace(/\/+$/, ""))
  .filter(Boolean);

/**
 * Optional hosted copy of the web app's music route handlers
 * (`/api/music/search|playlists|lyrics`). When set (EXPO_PUBLIC_WEB_BASE_URL),
 * the app uses it — exactly the URLs the browser version used — so the
 * server-side caching and lyric circuit breakers keep working unchanged.
 */
export const WEB_BASE_URL = (webBase ?? "").trim().replace(/\/+$/, "");
