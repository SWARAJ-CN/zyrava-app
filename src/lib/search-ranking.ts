import type { Song } from "./saavn";

export function searchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/([a-z])[\u0300-\u036f]+/gi, "$1")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function parseSongQuery(query: string) {
  const text = searchText(query);
  const parts = text.split(" by ");
  // Keep titles such as “Stand by Me” intact.
  const explicit =
    parts.length === 2 &&
    !!parts[0] &&
    !!parts[1] &&
    !/^(me|you|us|myself|yourself|itself|the way)$/.test(parts[1]);
  return { text, title: explicit ? parts[0] : text, artist: explicit ? parts[1] : "" };
}

/** One edit or adjacent transposition; short words must match exactly. */
function tokenMatch(a: string, b: string): number {
  if (a === b) return 1;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return 0;
  if (a.length === b.length) {
    const diffs = [...a].map((c, i) => (c === b[i] ? -1 : i)).filter((i) => i >= 0);
    if (diffs.length === 1) return 0.85;
    if (
      diffs.length === 2 &&
      diffs[1] === diffs[0] + 1 &&
      a[diffs[0]] === b[diffs[1]] &&
      a[diffs[1]] === b[diffs[0]]
    )
      return 0.85;
    return 0;
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.slice(i) === long.slice(i + 1) ? 0.85 : 0;
}

function coverage(query: string, field: string): number {
  const wanted = query.split(" ").filter(Boolean);
  const available = field.split(" ");
  return wanted.length
    ? wanted.reduce(
        (sum, word) =>
          sum + Math.max(0, ...available.map((candidate) => tokenMatch(word, candidate))),
        0
      ) / wanted.length
    : 0;
}

const VERSIONS =
  /\b(remix(?:ed)?|instrumental|karaoke|tribute|cover|acoustic|slowed|sped up|reverb|nightcore|remaster(?:ed)?|radio edit)\b/g;
export function recordingVersion(title: string): string {
  const versions = new Set(searchText(title).match(VERSIONS) ?? []);
  if (/[(\[]live\b|[-–—]\s*live\b/i.test(title)) versions.add("live");
  return [...versions].sort().join(" ");
}

export function songSearchScore(song: Song, query: string): number {
  const intent = parseSongQuery(query);
  const title = searchText(song.title);
  const artist = searchText(song.artist);
  const album = searchText(song.album);
  let score: number;
  if (intent.artist) {
    const artistMatch = coverage(intent.artist, artist);
    score = coverage(intent.title, title) * 100 + artistMatch * 120;
    if (title === intent.title) score += 100;
    if (artist === intent.artist) score += 60;
    if (artistMatch < 0.8) score -= 140;
  } else {
    const combined = coverage(intent.text, `${title} ${artist}`);
    score = combined * 100 + coverage(intent.text, title) * 40 + coverage(intent.text, artist) * 30;
    if (combined >= 0.98) score += 60;
    if (title === intent.text) score += 120;
    if (artist === intent.text) score += 100;
    // “title artist” / “artist title”: an artist named in the actual artist
    // field beats a cover that merely puts that name inside its title.
    const artistQuery = intent.text.startsWith(`${title} `)
      ? intent.text.slice(title.length + 1)
      : intent.text.endsWith(` ${title}`)
        ? intent.text.slice(0, -title.length - 1)
        : "";
    const artistMatch = coverage(artistQuery, artist);
    if (artistQuery && artistMatch >= 0.8) score += 260 * artistMatch;
    // Album words may help discovery, but cannot beat a title/artist match.
    score += coverage(intent.text, album) * 8;
  }
  const versions = new Set(`${title} ${album}`.match(VERSIONS) ?? []);
  for (const version of versions) {
    if (!intent.text.includes(version)) score -= version.startsWith("remaster") ? 6 : 45;
    else if (title.includes(version)) score += 35;
  }
  // “Live Forever” is a title; only marked live versions get this penalty.
  if (/[(\[]live\b|[-–—]\s*live\b/i.test(song.title) && !/\blive\b/.test(intent.text)) score -= 40;
  return score;
}

export function rankSearchResults(songs: Song[], query: string): Song[] {
  return songs
    .map((song, index) => ({ song, index, score: songSearchScore(song, query) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.song);
}

/** Metadata match only: never claims a recording is an authenticated original. */
export function isStrongSongMatch(song: Song, query: string): boolean {
  const intent = parseSongQuery(query);
  const title = searchText(song.title);
  if (intent.artist)
    return (
      title === intent.title &&
      coverage(intent.artist, searchText(song.artist)) >= 0.8 &&
      !recordingVersion(`${song.title} ${song.album}`)
    );
  const unmarked = !recordingVersion(`${song.title} ${song.album}`) && !/[([]/.test(song.title);
  return (
    (title === intent.text ||
      coverage(intent.text, `${title} ${searchText(song.artist)}`) >= 0.98) &&
    unmarked
  );
}
