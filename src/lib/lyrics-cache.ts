import { lookupLyrics } from "./lrclib";
import type { LyricsResult } from "./lyrics";
import type { Song } from "./saavn";

const TTL = 24 * 60 * 60 * 1000;
const MAX_SONGS = 100;

export type LyricsState =
  | { kind: "ready"; result: LyricsResult }
  | { kind: "none" }
  | { kind: "instrumental" }
  /** A failed request, never cached: the Retry button is the recovery. */
  | { kind: "error" };

const store = new Map<string, { at: number; state: LyricsState }>();

export function cachedLyrics(id: string): LyricsState | undefined {
  const entry = store.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.at < TTL) return entry.state;
  store.delete(id);
  return undefined;
}

/** Live request for one song id — a reopen during the fetch reuses it. */
const inflight = new Map<string, Promise<LyricsState>>();

/**
 * One lyrics lookup. A thrown failure (rate limit, outage) is never "this
 * song has no words", so the two states stay distinguishable — exactly what
 * the route handler signalled with its status codes.
 */
async function fetchLyrics(song: Song): Promise<LyricsState> {
  try {
    const outcome = await lookupLyrics({
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: Math.round(song.duration || 0),
    });
    if (outcome.status === "none") {
      return outcome.reason === "instrumental" ? { kind: "instrumental" } : { kind: "none" };
    }
    const result = outcome.result;
    if (result.body.kind === "timed" && result.body.lines.length >= 2) {
      return { kind: "ready", result };
    }
    if (result.body.kind === "plain" && result.body.stanzas.length) {
      return { kind: "ready", result };
    }
    return { kind: "none" };
  } catch {
    // A LyricsUpstreamError is an outage; anything else failed to answer.
    // Both read the same here: "not found" must not be cached for an error.
    return { kind: "error" };
  }
}

/** Start on song selection; the panel shares this request and reads cached results synchronously. */
export function loadLyrics(song: Song): Promise<LyricsState> {
  const hit = cachedLyrics(song.id);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(song.id);
  if (pending) return pending;
  const request = fetchLyrics(song).then((state) => {
    if (inflight.get(song.id) === request) {
      inflight.delete(song.id);
      if (state.kind !== "error") {
        store.set(song.id, { at: Date.now(), state });
        while (store.size > MAX_SONGS) store.delete(store.keys().next().value!);
      }
    }
    return state;
  });
  inflight.set(song.id, request);
  return request;
}

export function invalidateLyrics(id: string): void {
  store.delete(id);
  inflight.delete(id);
}
