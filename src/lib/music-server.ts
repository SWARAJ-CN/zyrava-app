import { WEB_BASE_URL } from "./env";

export class MusicServerError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "MusicServerError";
  }
}

/** Use the same Next route as the web UI when a web origin is configured. */
export async function fetchMusicRoute<T>(path: string): Promise<T | undefined> {
  if (!WEB_BASE_URL) return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    // Account cookies and bearer tokens must never accompany catalogue calls.
    const response = await fetch(`${WEB_BASE_URL}/api/music/${path}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new MusicServerError(
        typeof payload?.error === "string"
          ? payload.error
          : "The music service is unavailable right now.",
        response.status
      );
    }
    if (!payload || typeof payload !== "object") {
      throw new MusicServerError("The music server returned an invalid response.", 502);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof MusicServerError) throw error;
    throw new MusicServerError("Could not reach the music server. Please try again.", 503);
  } finally {
    clearTimeout(timer);
  }
}

/** The Next routes parse and clamp these parameters before asking upstream. */
export function musicInt(value: number, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? fallback : Math.min(max, Math.max(min, parsed));
}
