/**
 * Device-local audio: saved copies of catalogue songs and files the user
 * imports from their own folders.
 *
 * Two stores are kept apart on purpose — metadata rows that a list can render
 * without touching a byte of audio, and the blobs behind them. Reading every
 * blob to paint a list would take a phone down.
 *
 * Web kept the rows in an IndexedDB object store and the blobs beside them.
 * On device the split is the same: audio bytes live in
 * `documentDirectory/zyrava-offline/{kind}/{id}{ext}` (the SDK 58
 * `expo-file-system` API) and the metadata rows — fields identical to
 * `OfflineTrack`, the same rows the browser stored — live under the store key
 * `zyrava:offline-tracks`. `putTrack` writes the file first and only then
 * saves the row, so a row never exists without its audio, which is the
 * one-transaction guarantee the IndexedDB version gave.
 */

import SHA256 from "crypto-js/sha256";
import { Directory, File, Paths } from "expo-file-system";
import type { DocumentPickerAsset, DocumentPickerResult } from "expo-document-picker";
import { getAudioEngine } from "./audio-engine";
import { readJson, writeJson } from "./store";
import type { OfflineSource, Song } from "./saavn";

const audioEngine = getAudioEngine();

export type OfflineKind = OfflineSource;

export interface OfflineTrack {
  id: string;
  kind: OfflineKind;
  title: string;
  artist: string;
  album: string;
  image: string;
  imageLarge: string;
  /** Seconds; 0 when the container never told us. */
  duration: number;
  bytes: number;
  mime: string;
  fileName: string;
  addedAt: number;
}

/** The old IndexedDB name; now the folder under the document directory. */
const DIR_NAME = "zyrava-offline";
/** Metadata rows, the stand-in for the old `tracks` object store. */
const TRACKS_KEY = "zyrava:offline-tracks";

/** Extensions worth offering to the decoder — everything else is skipped. */
const AUDIO_EXT = /\.(m4a|m4b|mp3|mp4|aac|ogg|oga|opus|flac|wav|weba|webm)$/i;

const MAX_IMPORT_FILES = 400;
const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
/** Writes stop short of the ceiling so the device never evicts us outright. */
const QUOTA_HEADROOM = 0.9;

const KINDS: OfflineKind[] = ["download", "local"];

function offlineRoot(): Directory {
  return new Directory(Paths.document, DIR_NAME);
}

function kindDirectory(kind: OfflineKind): Directory {
  return new Directory(Paths.document, DIR_NAME, kind);
}

let dirsPromise: Promise<void> | null = null;

/**
 * Formerly `openDb()` — the IndexedDB connection. There is no database to
 * open on device, so this now guarantees the storage folders exist before
 * anything reads or writes them, and keeps the one-shot promise semantics the
 * browser version had (a failed attempt is retried by the next caller).
 */
export function openDb(): Promise<void> {
  if (!dirsPromise) {
    dirsPromise = (async () => {
      const root = offlineRoot();
      if (!root.exists) root.create({ intermediates: true });
      for (const kind of KINDS) {
        const dir = kindDirectory(kind);
        if (!dir.exists) dir.create({ intermediates: false });
      }
    })().catch((error: unknown) => {
      dirsPromise = null;
      throw error;
    });
  }
  return dirsPromise;
}

function readRows(): OfflineTrack[] {
  const rows = readJson<OfflineTrack[]>(TRACKS_KEY, []);
  return Array.isArray(rows) ? rows.filter((row) => row && typeof row.id === "string") : [];
}

/** Rows for one kind, newest first — metadata only, so this stays cheap. */
export async function listTracks(kind: OfflineKind): Promise<OfflineTrack[]> {
  await openDb();
  return readRows()
    .filter((track) => track.kind === kind)
    .sort((a, b) => b.addedAt - a.addedAt);
}

/** Where the audio for a row lives: `{kind}/{id}.{extensionFor(mime, fileName)}`. */
function fileFor(track: OfflineTrack): File {
  const ext = extensionFor(track.mime, track.fileName);
  return new File(kindDirectory(track.kind), `${track.id}.${ext}`);
}

/**
 * The row and its audio, kept in step: the bytes land on disk first and the
 * row is only written once they are there (the web wrapped both in one
 * IndexedDB transaction).
 *
 * `data` is the audio itself: fetched bytes (`Uint8Array`/`ArrayBuffer`) or a
 * file already on the device — an expo-file-system `File` or a URI string, as
 * returned by the document picker.
 */
export async function putTrack(
  track: OfflineTrack,
  data: Uint8Array | ArrayBuffer | File | string
): Promise<void> {
  await openDb();
  const target = fileFor(track);
  if (target.exists) target.delete();

  if (typeof data === "string" || data instanceof File) {
    const source = typeof data === "string" ? new File(data) : data;
    await source.copy(target, { overwrite: false });
  } else {
    target.create();
    await target.write(data);
  }

  const rows = readRows().filter((row) => row.id !== track.id);
  rows.push(track);
  writeJson(TRACKS_KEY, rows);
}

/**
 * The local URI of a saved copy's audio — what replaced `getBlob`, which used
 * to hand back the IndexedDB blob for the `<audio>` element. Playback hands
 * this straight to the native audio engine instead. `undefined` when the copy
 * is gone.
 */
export async function getTrackUri(id: string): Promise<string | undefined> {
  await openDb();
  const row = readRows().find((track) => track.id === id);
  if (row) {
    const file = fileFor(row);
    if (file.exists) return file.uri;
  }
  // A row can outlive its exact name if the mime was corrected after saving;
  // the id still owns the file, so look it up by prefix.
  for (const uri of scanKindDirectories(id)) return uri;
  return undefined;
}

/** URIs of every file named `{id}.*` under either kind folder. */
function scanKindDirectories(id: string): string[] {
  const hits: string[] = [];
  for (const kind of KINDS) {
    const dir = kindDirectory(kind);
    if (!dir.exists) continue;
    for (const entry of dir.list()) {
      if (entry instanceof File && entry.name.startsWith(`${id}.`)) hits.push(entry.uri);
    }
  }
  return hits;
}

/** The "is this already on the device" check — keyed lookup, no file read. */
export async function hasTrack(id: string): Promise<boolean> {
  await openDb();
  return readRows().some((track) => track.id === id);
}

export async function deleteTrack(id: string): Promise<void> {
  await openDb();
  const row = readRows().find((track) => track.id === id);
  const doomed = new Set<string>();
  if (row) {
    const file = fileFor(row);
    if (file.exists) doomed.add(file.uri);
  }
  for (const uri of scanKindDirectories(id)) doomed.add(uri);
  for (const uri of doomed) {
    try {
      new File(uri).delete();
    } catch {
      /* already gone — the row removal below still cleans the list */
    }
  }
  writeJson(
    TRACKS_KEY,
    readRows().filter((track) => track.id !== id)
  );
}

/**
 * The web read the browser's origin quota; a device has no per-origin store,
 * so the whole volume stands in: `quota` is the total disk space and `usage`
 * the part of it the device already holds.
 */
export async function getQuota(): Promise<{ usage: number; quota: number }> {
  const quota = Paths.totalDiskSpace;
  const free = Paths.availableDiskSpace;
  return { usage: Math.max(0, quota - free), quota };
}

/** True when the write fits under the headroom kept off the free space. */
export async function roomFor(bytes: number): Promise<boolean> {
  const free = Paths.availableDiskSpace;
  if (!free) return true;
  return bytes <= free * QUOTA_HEADROOM;
}

/* ── the picking surface ──
 * The web walked a user-chosen folder with `showDirectoryPicker`; there is no
 * folder walk on device. The system document picker (expo-document-picker,
 * multi-select) already lets the user descend into folders and hands back a
 * flat asset list, so the depth-4 bound of the old walk is enforced by the
 * picker's own UI; this keeps the limit semantics — audio extensions only,
 * first `limit` wins. Accepts either the raw `DocumentPickerResult` or the
 * unwrapped asset list, and is awaited like the web's async walk.
 */
export async function collectPickedFiles(
  result: DocumentPickerResult | DocumentPickerAsset[],
  limit: number
): Promise<DocumentPickerAsset[]> {
  const assets = Array.isArray(result) ? result : result.canceled ? [] : (result.assets ?? []);
  return assets
    .filter((asset) => typeof asset.name === "string" && isAudioFileName(asset.name))
    .slice(0, limit);
}

/* ── helpers ── */

export function isAudioFileName(name: string): boolean {
  return AUDIO_EXT.test(name);
}

export const IMPORT_LIMITS = { maxFiles: MAX_IMPORT_FILES, maxBytes: MAX_IMPORT_BYTES };

/** A name the user can keep: prefer the file's own tail, then the container. */
export function extensionFor(mime: string, fileName: string): string {
  const fromName = /\.([a-z0-9]+)$/i.exec(fileName)?.[1];
  if (fromName) return fromName;
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("flac")) return "flac";
  if (mime.includes("weba") || mime.includes("webm")) return "weba";
  return "m4a";
}

/** The file fields the fingerprint runs on — a `File` or a picked asset. */
export interface LocalFileSeed {
  name: string;
  size?: number;
  lastModified?: number;
}

/**
 * A fingerprint that identifies the same file across imports. The web hashed
 * `size:lastModified:name` with SHA-256 when `crypto.subtle` was reachable;
 * use the same UTF-8 SHA-256 in JavaScript so existing IDs stay stable even
 * in binaries without ExpoCrypto. This hashes metadata, not audio bytes.
 */
export async function localIdFor(file: LocalFileSeed): Promise<string> {
  const seed = `${file.size ?? 0}:${file.lastModified ?? 0}:${file.name}`;
  try {
    const hex = SHA256(seed).toString();
    if (/^[0-9a-f]{64}$/.test(hex)) return `local:${hex.slice(0, 24)}`;
    throw new Error("SHA-256 returned an unexpected digest");
  } catch {
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `local:${(hash >>> 0).toString(36).padStart(7, "0")}`;
  }
}

/** `03. Artist - Title.m4a` reads as a track; anything else keeps its name. */
export function deriveName(file: LocalFileSeed): { title: string; artist: string } {
  const base = file.name.replace(/\.[^.]+$/, "").replace(/^\s*\d{1,3}[-_.]\s*/, "");
  const split = base.split(/\s+[-–—]\s+/);
  if (split.length >= 2) {
    const artist = split[0].trim();
    const title = split.slice(1).join(" - ").trim();
    if (artist && title) return { title, artist };
  }
  return { title: base.trim() || file.name, artist: "Local files" };
}

/** `fileFromTrack` gives a saved copy the shape the rest of the app plays. */
export function toSong(track: OfflineTrack): Song {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    year: "",
    language: "",
    duration: track.duration,
    image: track.image,
    imageLarge: track.imageLarge,
    // Ignored whenever `offline` is set; kept so no consumer reads undefined.
    streamUrl: "",
    pageUrl: "",
    offline: { kind: track.kind, id: track.id },
  };
}

/**
 * Ask the audio engine how long the container says it is. The web probed a
 * detached `<audio>` element; here the react-native-audio-api duration probe
 * covers URIs and raw bytes, with a throw-away `AudioContext` decode as the
 * fallback for containers the probe shrugs off. Resolves 0 rather than
 * rejecting: an undecodable file has already been refused elsewhere, and the
 * web's 6-second patience is kept.
 */
export async function readDuration(
  source: string | File | Uint8Array | ArrayBuffer
): Promise<number> {
  const input: string | ArrayBuffer =
    typeof source === "string"
      ? source
      : source instanceof File
        ? source.uri
        : source instanceof ArrayBuffer
          ? source
          : // A Uint8Array may be a view on a larger buffer; hand the decoder
            // a detached copy that owns exactly these bytes.
            source.slice(source.byteOffset, source.byteOffset + source.byteLength).buffer;

  const probe: Promise<number> = (async () => {
    try {
      const duration = await (audioEngine?.getAudioDuration ?? (async () => Number.NaN))(input);
      if (Number.isFinite(duration) && duration > 0) return Math.round(duration);
    } catch {
      /* fall through to the decoder */
    }
    try {
      if (!audioEngine) return 0;
      const context = new audioEngine.AudioContext();
      try {
        const buffer = await context.decodeAudioData(input);
        return Number.isFinite(buffer.duration) ? Math.round(buffer.duration) : 0;
      } finally {
        await context.close().catch(() => undefined);
      }
    } catch {
      return 0;
    }
  })();

  const patience = new Promise<number>((resolve) => setTimeout(() => resolve(0), 6000));
  return Promise.race([probe, patience]);
}
