import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { useToast } from "@/components/providers/ToastProvider";
import { useTaste } from "@/components/providers/TasteProvider";
import {
  IMPORT_LIMITS,
  collectPickedFiles,
  deleteTrack,
  deriveName,
  extensionFor,
  getTrackUri,
  listTracks,
  localIdFor,
  putTrack,
  readDuration,
  roomFor,
  type OfflineTrack,
} from "@/lib/offline";
import type { Song } from "@/lib/saavn";

interface SaveProgress {
  loaded: number;
  total: number;
}

interface ImportProgress {
  done: number;
  total: number;
}

type PickedResult = DocumentPicker.DocumentPickerResult;

interface OfflineValue {
  downloads: OfflineTrack[];
  locals: OfflineTrack[];
  ready: boolean;
  /** Whether this device can bring songs in from outside the app. */
  canPickFolder: boolean;
  savedIds: Set<string>;
  progress: Record<string, SaveProgress>;
  /** How far through a bulk save we are, beyond the one song in `progress`. */
  saving: ImportProgress | null;
  importing: ImportProgress | null;
  save: (song: Song) => Promise<void>;
  saveAll: (songs: Song[]) => Promise<void>;
  removeSaved: (id: string) => Promise<void>;
  removeLocal: (id: string) => Promise<void>;
  /** Hands a copy the user can keep outside the app to the share sheet. */
  exportCopy: (id: string) => Promise<void>;
  /** Folder import: the OS picker has no pinned folder, so it opens as a
   *  multi-select over the files (the web's "zyrava-songs" id concept folds
   *  into the same flow). */
  importFolder: () => Promise<void>;
  importFiles: () => Promise<void>;
  /** file:// URI for device-local audio, or null when the copy is gone. */
  openPlaybackUrl: (id: string) => Promise<string | null>;
}

const OfflineContext = createContext<OfflineValue | null>(null);

const NOT_SAVABLE = "This song can't be saved on this device.";
const NO_ROOM = "There isn't enough room left on this device.";

/** Saved copies and imported files, held on this device. */
export function OfflineProvider({ children }: { children: ReactNode }) {
  const { toast, success, error } = useToast();

  const [downloads, setDownloads] = useState<OfflineTrack[]>([]);
  const [locals, setLocals] = useState<OfflineTrack[]>([]);
  const [ready, setReady] = useState(false);
  const [canPickFolder, setCanPickFolder] = useState(false);
  const [progress, setProgress] = useState<Record<string, SaveProgress>>({});
  const [saving, setSaving] = useState<ImportProgress | null>(null);
  const [importing, setImporting] = useState<ImportProgress | null>(null);

  const savesRef = useRef(new Map<string, AbortController>());
  /* No object-URL slot to track: playback reads the saved file's file:// URI
     straight from the offline folder (lib/offline getTrackUri). */

  useEffect(() => {
    let alive = true;
    void (async () => {
      // expo-document-picker exists on every device this build runs on.
      setCanPickFolder(true);
      try {
        const [saved, own] = await Promise.all([listTracks("download"), listTracks("local")]);
        if (!alive) return;
        setDownloads(saved);
        setLocals(own);
      } catch {
        /* A blocked store leaves the tabs empty rather than broken. */
      }
      if (alive) setReady(true);
      // navigator.storage.persist() is dropped: expo-file-system app storage
      // is not evicted the way a browser origin's quota is (PORTING §16).
    })();
    return () => {
      alive = false;
    };
  }, []);

  const savedIds = useMemo(() => new Set(downloads.map((track) => track.id)), [downloads]);

  const markProgress = useCallback((id: string, value: SaveProgress | null) => {
    setProgress((previous) => {
      if (!value) {
        if (!(id in previous)) return previous;
        const next = { ...previous };
        delete next[id];
        return next;
      }
      return { ...previous, [id]: value };
    });
  }, []);

  /**
   * Reads the whole body so a row can show how far it got. RN's fetch has no
   * ReadableStream body, so the chunked 150 ms paint below runs only when a
   * stream reader exists; the device path lands one arrayBuffer write with the
   * opening {loaded: 0, total} tick already painted by the caller.
   */
  const readBody = useCallback(
    async (response: Response, id: string): Promise<Uint8Array> => {
      const total = Number(response.headers.get("content-length")) || 0;
      const reader = response.body?.getReader?.();
      if (!reader) return new Uint8Array(await response.arrayBuffer());

      // Aborting the request errors the body stream, so the read below rejects.
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      let painted = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        const now = Date.now();
        if (now - painted > 150) {
          painted = now;
          markProgress(id, { loaded, total });
        }
      }
      const merged = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return merged;
    },
    [markProgress]
  );

  /**
   * Streams one catalogue song onto the device. `quiet` keeps a bulk run from
   * raising a toast per track — the caller summarises instead.
   */
  const { record } = useTaste();

  const saveOne = useCallback(
    async (song: Song, quiet: boolean): Promise<"saved" | "skipped" | "failed"> => {
      if (!song.streamUrl || savesRef.current.has(song.id)) return "skipped";
      if (await getTrackUri(song.id)) {
        if (!quiet) toast({ title: "Already on this device", description: song.title });
        return "skipped";
      }

      const controller = new AbortController();
      savesRef.current.set(song.id, controller);
      markProgress(song.id, { loaded: 0, total: 0 });
      try {
        const response = await fetch(song.streamUrl, { signal: controller.signal });
        if (!response.ok) throw new Error(NOT_SAVABLE);
        const bytes = await readBody(response, song.id);
        if (!bytes.byteLength) throw new Error(NOT_SAVABLE);
        if (!(await roomFor(bytes.byteLength))) throw new Error(NO_ROOM);

        const mime = response.headers.get("content-type")?.split(";")[0] || "audio/mp4";
        const ext = extensionFor(mime, "");
        const track: OfflineTrack = {
          id: song.id,
          kind: "download",
          title: song.title,
          artist: song.artist,
          album: song.album,
          image: song.image,
          imageLarge: song.imageLarge,
          duration: song.duration,
          bytes: bytes.byteLength,
          mime,
          fileName: `${song.artist} - ${song.title}`.replace(/[\\/:*?"<>|]/g, "") + `.${ext}`,
          addedAt: Date.now(),
        };
        // The bytes are written under documentDirectory/zyrava-offline/.
        await putTrack(track, bytes);
        setDownloads(await listTracks("download"));
        if (!quiet) success("Saved on this device", `${track.title} · ${track.artist}`);
        record("save", song, { pct: 1 });
        return "saved";
      } catch (caught: unknown) {
        if (controller.signal.aborted) return "skipped";
        const message = caught instanceof Error && caught.message === NO_ROOM ? NO_ROOM : NOT_SAVABLE;
        if (!quiet) error(message, song.title);
        return "failed";
      } finally {
        savesRef.current.delete(song.id);
        markProgress(song.id, null);
      }
    },
    [error, markProgress, readBody, record, success, toast]
  );

  const save = useCallback(
    async (song: Song) => {
      await saveOne(song, false);
    },
    [saveOne]
  );

  /** One at a time: this shares the network with whatever is already playing. */
  const saveAll = useCallback(
    async (songs: Song[]) => {
      const pending = songs.filter((song) => song.streamUrl && !savedIds.has(song.id));
      if (!pending.length) {
        toast({ title: "Already on this device", description: "Every song here is saved." });
        return;
      }
      let savedCount = 0;
      let failed = 0;
      setSaving({ done: 0, total: pending.length });
      for (let i = 0; i < pending.length; i += 1) {
        const outcome = await saveOne(pending[i], true);
        setSaving({ done: i + 1, total: pending.length });
        if (outcome === "saved") savedCount += 1;
        if (outcome === "failed") failed += 1;
      }
      setSaving(null);
      const tail = failed ? ` · ${failed} couldn't be saved` : "";
      if (savedCount) {
        success("Saved on this device", `${savedCount} ${savedCount === 1 ? "song" : "songs"}${tail}`);
      } else {
        error(NOT_SAVABLE, `${pending.length} songs`);
      }
    },
    [error, saveOne, savedIds, success, toast]
  );

  const removeSaved = useCallback(
    async (id: string) => {
      savesRef.current.get(id)?.abort();
      savesRef.current.delete(id);
      markProgress(id, null);
      await deleteTrack(id);
      setDownloads(await listTracks("download"));
    },
    [markProgress]
  );

  const removeLocal = useCallback(async (id: string) => {
    await deleteTrack(id);
    setLocals(await listTracks("local"));
  }, []);

  const exportCopy = useCallback(
    async (id: string) => {
      const track =
        downloads.find((entry) => entry.id === id) ?? locals.find((entry) => entry.id === id);
      const uri = await getTrackUri(id);
      if (!track || !uri) {
        error("This saved copy is no longer on this device.");
        return;
      }
      const ext = extensionFor(track.mime, track.fileName);
      const name = `${track.fileName.replace(/\.[^.]+$/i, "")}.${ext}`;
      // showSaveFilePicker/saveViaAnchor → the OS share sheet. A dismissal is
      // the user's own "AbortError" and stays silent, exactly like the web.
      try {
        await Sharing.shareAsync(uri, { mimeType: track.mime, dialogTitle: name });
        success("Export started", name);
      } catch {
        /* sharing unavailable or dismissed — the copy stays on the device */
      }
    },
    [downloads, error, locals, success]
  );

  const addFiles = useCallback(
    async (result: PickedResult) => {
      /* collectPickedFiles carries the web's audio-name filter and max-files
         cap; the max-bytes cap that IMPORT_LIMITS applied lands right after it
         so over-long files never reach the store. */
      const capped = collectPickedFiles(result, IMPORT_LIMITS.maxFiles).filter(
        (asset) => (asset.size ?? 0) <= IMPORT_LIMITS.maxBytes
      );
      if (!capped.length) {
        toast({
          title: "No songs found there",
          description: "Pick a folder that holds audio files.",
        });
        return;
      }

      setImporting({ done: 0, total: capped.length });
      let added = 0;
      let already = 0;
      let failed = 0;
      for (let i = 0; i < capped.length; i += 1) {
        const file = capped[i];
        setImporting({ done: i, total: capped.length });
        try {
          const id = await localIdFor(file);
          if (await getTrackUri(id)) {
            already += 1;
            continue;
          }
          if (!(await roomFor(file.size ?? 0))) {
            error(NO_ROOM, `${added} of ${capped.length} were added`);
            break;
          }
          const { title, artist } = deriveName(file);
          const track: OfflineTrack = {
            id,
            kind: "local",
            title,
            artist,
            album: "",
            image: "",
            imageLarge: "",
            duration: await readDuration(file.uri),
            bytes: file.size ?? 0,
            mime: file.mimeType || file.type || "audio/mp4",
            fileName: file.name,
            addedAt: Date.now(),
          };
          // putTrack copies the picked file into the offline folder.
          await putTrack(track, file.uri);
          added += 1;
        } catch {
          failed += 1;
        }
      }
      setImporting(null);
      setLocals(await listTracks("local"));

      const notes = [already ? `${already} already added` : "", failed ? `${failed} unreadable` : ""]
        .filter(Boolean)
        .join(" · ");
      if (added) {
        success("Added your songs", `${added} ${added === 1 ? "song" : "songs"}${notes ? ` · ${notes}` : ""}`);
      } else if (already) {
        toast({ title: "Nothing new to add", description: `${already} already imported.` });
      } else {
        error("Those files couldn't be read", notes || undefined);
      }
    },
    [error, success, toast]
  );

  const presentPicker = useCallback(async () => {
    const result = await DocumentPicker.presentAsync({
      type: ["*/*"],
      multiSelect: true,
      allowEditing: false,
    });
    if (result.canceled || !result.assets?.length) return null;
    return result.assets;
  }, []);

  const importFolder = useCallback(async () => {
    setImporting({ done: 0, total: 0 });
    try {
      // The web pinned a folder with the id "zyrava-songs" after one click;
      // the native picker cannot hold a folder handle, so it opens as a
      // multi-select over the same songs instead.
      const assets = await presentPicker();
      setImporting(null);
      if (assets) await addFiles(assets);
    } catch (caught: unknown) {
      setImporting(null);
      if (caught instanceof Error && caught.name === "AbortError") return;
      error("That folder couldn't be read", "Try choosing the files themselves instead.");
    }
  }, [addFiles, error, presentPicker]);

  const importFiles = useCallback(async () => {
    try {
      const assets = await presentPicker();
      if (assets) await addFiles(assets);
    } catch {
      /* the sheet was dismissed — nothing was owed a toast */
    }
  }, [addFiles, presentPicker]);

  const openPlaybackUrl = useCallback(async (id: string) => {
    /* Stands in for the web's object-URL slot: the saved file's URI is stable,
       so there is nothing to revoke and no dead-URL switch to guard. */
    return getTrackUri(id);
  }, []);

  const value = useMemo<OfflineValue>(
    () => ({
      downloads,
      locals,
      ready,
      canPickFolder,
      savedIds,
      progress,
      saving,
      importing,
      save,
      saveAll,
      removeSaved,
      removeLocal,
      exportCopy,
      importFolder,
      importFiles,
      openPlaybackUrl,
    }),
    [
      downloads,
      locals,
      ready,
      canPickFolder,
      savedIds,
      progress,
      saving,
      importing,
      save,
      saveAll,
      removeSaved,
      removeLocal,
      exportCopy,
      importFolder,
      importFiles,
      openPlaybackUrl,
    ]
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineValue {
  const context = useContext(OfflineContext);
  if (!context) throw new Error("useOffline must be used within OfflineProvider");
  return context;
}
