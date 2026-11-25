import { matchesRegions, matchesVibe, type Vibe } from "@/components/features/music/filters";
import type { Song } from "@/lib/saavn";

import { songSearchScore, rankSearchResults } from "./search-ranking";

export interface RankingContext {
  /** Typed search phrase, or "" when browsing a region. */
  query?: string;
  vibes?: Vibe[];
  regionLabels?: string[];
  /** Max tracks from one artist in the result; keeps a page from going stale. */
  artistCap?: number;
}

/**
 * Relevance-first ranking for a pooled set of results.
 *
 * 1. typed queries use the shared title/artist and recording-version scorer
 * 2. each checked vibe earns +3 and a matching language +2
 * 3. ties keep the catalogue's own order, so plain region browsing is stable
 * 4. browsing caps artists at two; named searches keep relevance order
 */
export function rankSongs(songs: Song[], context: RankingContext = {}): Song[] {
  const query = context.query?.trim() ?? "";
  if (query) return rankSearchResults(songs, query);
  const vibes = context.vibes ?? [];
  const regions = context.regionLabels ?? [];
  const artistCap = context.artistCap ?? (query ? Number.POSITIVE_INFINITY : 2);

  const scored = songs.map((song, position) => {
    let score = query ? songSearchScore(song, query) : 0;
    for (const vibe of vibes) {
      if (matchesVibe(song, vibe)) score += 3;
    }
    if (regions.length > 0 && matchesRegions(song, regions)) score += 2;

    return { song, score, position, artist: song.artist.toLowerCase() };
  });

  // Stable: equal scores keep the order the catalogue returned them in.
  scored.sort((a, b) => b.score - a.score || a.position - b.position);

  const preferred: Song[] = [];
  const deferred: Song[] = [];
  const perArtist = new Map<string, number>();

  for (const entry of scored) {
    const used = perArtist.get(entry.artist) ?? 0;
    if (used < artistCap) {
      perArtist.set(entry.artist, used + 1);
      preferred.push(entry.song);
    } else {
      deferred.push(entry.song);
    }
  }

  return [...preferred, ...deferred];
}
