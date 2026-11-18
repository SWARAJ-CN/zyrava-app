// @refresh reset
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { Directory, File, FileMode, Paths, type FileHandle } from "expo-file-system";
import { WebView } from "react-native-webview";
import {
  karaokeWorkerHtml,
  KARAOKE_WORKER_VERSION,
  KARAOKE_CHUNK_BYTES,
  type KaraokePreparationProgress,
} from "@/lib/karaoke-worker";

const cache = new Map<string, string>();
let cacheDirectoryCleaned = false;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 54 * 1024 * 1024;
const HTML = { html: karaokeWorkerHtml() };

/** A silent, noninteractive offline processor. The result plays with expo-audio. */
export function GoKaraokePreparation({
  source,
  onReady,
  onError,
  onProgress,
}: {
  source: string;
  onReady: (original: string, result: string) => void;
  onError: (original: string, message: string) => void;
  onProgress: (original: string, progress: KaraokePreparationProgress) => void;
}) {
  const web = useRef<WebView<unknown>>(null);
  const handlers = useRef({ onReady, onError, onProgress });
  useEffect(() => {
    handlers.current = { onReady, onError, onProgress };
  }, [onReady, onError, onProgress]);
  const [webReady, setWebReady] = useState(false);
  const output = useRef<File | null>(null);
  const handle = useRef<FileHandle | null>(null);
  const written = useRef(0);
  const active = useRef(true);
  const finished = useRef(false);
  const job = useRef<{ id: string; next: number; writing: boolean; total: number } | null>(null);
  const activity = useRef({
    at: 0,
    stage: "starting" as KaraokePreparationProgress["stage"],
    percent: 0,
  });
  const downloadAbort = useRef<AbortController | null>(null);
  const report = useCallback(
    (stage: KaraokePreparationProgress["stage"], percent: number) => {
      if (!active.current || finished.current) return;
      const previous = activity.current;
      const next = Math.max(previous.percent, Math.min(100, Math.floor(percent)));
      activity.current = { at: Date.now(), stage, percent: next };
      if (previous.stage !== stage || previous.percent !== next)
        handlers.current.onProgress(source, { stage, percent: next });
    },
    [source]
  );

  useEffect(() => {
    active.current = true;
    activity.current = { at: Date.now(), stage: "starting", percent: 0 };
    handlers.current.onProgress(source, { stage: "starting", percent: 0 });
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") activity.current.at = Date.now();
    });
    // Long songs may take over two minutes. Only stop when a stage stops advancing.
    const timeout = setInterval(() => {
      if (
        finished.current ||
        !active.current ||
        (AppState.currentState && AppState.currentState !== "active")
      )
        return;
      const { stage, at } = activity.current;
      const limit = stage === "decoding" || stage === "processing" ? 180000 : 60000;
      if (Date.now() - at < limit) return;
      active.current = false;
      job.current = null;
      downloadAbort.current?.abort();
      handlers.current.onError(
        source,
        stage === "downloading"
          ? "The karaoke download stopped responding. Check your connection and retry."
          : `Karaoke ${stage} stopped responding. Tap Karaoke to retry.`
      );
    }, 5000);
    return () => {
      active.current = false;
      job.current = null;
      clearInterval(timeout);
      subscription.remove();
      downloadAbort.current?.abort();
      handle.current?.close();
      handle.current = null;
      if (!finished.current && output.current?.exists) output.current.delete();
    };
  }, [source]);

  useEffect(() => {
    const hit = cache.get(source);
    if (hit && new File(hit).exists) {
      finished.current = true;
      handlers.current.onReady(source, hit);
      return;
    }
    if (!webReady) return;
    let cancelled = false;
    const controller = new AbortController();
    downloadAbort.current = controller;
    let download: File | null = null;
    let oversized = false;
    const prepare = async () => {
      try {
        const directory = new Directory(Paths.cache, "karaoke");
        directory.create({ idempotent: true, intermediates: true });
        if (!cacheDirectoryCleaned) {
          // Files from a previous app session are no longer in the in-memory cache.
          for (const entry of directory.list()) if (entry instanceof File) entry.delete();
          cacheDirectoryCleaned = true;
        }
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        let input: File;
        if (source.startsWith("file://") || source.startsWith("content://"))
          input = new File(source);
        else {
          download = new File(directory, `${id}.input`);
          report("downloading", 0);
          let lastBytes = 0;
          input = await File.downloadFileAsync(source, download, {
            signal: controller.signal,
            onProgress: ({ bytesWritten, totalBytes }) => {
              if (cancelled || !active.current) return;
              if (bytesWritten > MAX_INPUT_BYTES || totalBytes > MAX_INPUT_BYTES) {
                oversized = true;
                controller.abort();
                return;
              }
              if (bytesWritten > lastBytes) {
                lastBytes = bytesWritten;
                report("downloading", totalBytes > 0 ? (25 * bytesWritten) / totalBytes : 0);
              }
            },
          });
        }
        if (cancelled || !active.current) return;
        if (input.size > MAX_INPUT_BYTES)
          throw new Error("This track is too large for Expo Go karaoke (25 MB limit).");
        report("reading", 25);
        const encoded = await input.base64();
        if (cancelled || !active.current) return;
        output.current = new File(directory, `${id}.wav`);
        output.current.create();
        handle.current = output.current.open(FileMode.WriteOnly);
        written.current = 0;
        job.current = { id, next: 0, writing: false, total: 0 };
        web.current?.injectJavaScript(
          `window.prepareKaraoke(${JSON.stringify(encoded)},${JSON.stringify(id)});true;`
        );
      } catch (error) {
        if (!cancelled && active.current)
          handlers.current.onError(
            source,
            oversized
              ? "This track is too large for Expo Go karaoke (25 MB limit)."
              : error instanceof Error
                ? error.message
                : "Could not prepare karaoke."
          );
      } finally {
        if (download?.exists) download.delete();
      }
    };
    void prepare();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [source, webReady, report]);

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
    >
      <WebView<unknown>
        key={KARAOKE_WORKER_VERSION}
        ref={web}
        source={HTML}
        originWhitelist={["*"]}
        javaScriptEnabled
        scrollEnabled={false}
        onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
        onError={() => handlers.current.onError(source, "The karaoke processor could not start.")}
        onMessage={(event) => {
          if (!active.current || finished.current) return;
          void (async () => {
            try {
              const message = JSON.parse(event.nativeEvent.data);
              if (message.type === "ready") {
                if (message.version !== KARAOKE_WORKER_VERSION)
                  throw new Error(
                    "The karaoke processor has changed. Reload the app and try again."
                  );
                setWebReady(true);
                return;
              }
              // Android can deliver queued messages after a WebView is replaced.
              // Only the job that owns this open file may write to it.
              const current = job.current;
              if (!current || message.job !== current.id) return;
              if (message.type === "error") throw new Error(message.message);
              if (message.type === "progress") {
                if (message.stage === "decoding") report("decoding", 30);
                else if (message.stage === "processing" && Number.isFinite(message.percent)) {
                  const percent = Math.min(69, Math.max(40, message.percent));
                  if (activity.current.stage !== "processing" || percent > activity.current.percent)
                    report("processing", percent);
                } else if (message.stage === "saving") {
                  if (
                    !Number.isInteger(message.totalBytes) ||
                    message.totalBytes < 44 ||
                    message.totalBytes > MAX_OUTPUT_BYTES
                  )
                    throw new Error("Karaoke audio exceeds the device limit.");
                  current.total = message.totalBytes;
                  report("saving", 70);
                }
                return;
              }
              if (message.type === "chunk") {
                const writer = handle.current;
                if (!writer)
                  throw new Error("The karaoke file writer closed before preparation finished.");
                // Do not write a duplicate while an asynchronous file write is pending.
                if (
                  message.index < current.next ||
                  (message.index === current.next && current.writing)
                )
                  return;
                if (message.index !== current.next)
                  throw new Error("Karaoke audio arrived out of order. Please retry.");
                if (
                  !Number.isInteger(message.bytes) ||
                  message.bytes <= 0 ||
                  message.bytes > KARAOKE_CHUNK_BYTES ||
                  typeof message.data !== "string" ||
                  message.data.length !== 4 * Math.ceil(message.bytes / 3)
                )
                  throw new Error("The karaoke audio transfer was truncated. Please retry.");
                const binary = atob(message.data);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                if (bytes.length !== message.bytes)
                  throw new Error("The karaoke audio transfer has an incorrect byte count.");
                if (written.current + bytes.length > MAX_OUTPUT_BYTES)
                  throw new Error("Karaoke audio exceeds the device limit.");
                current.writing = true;
                await writer.writeBytes(bytes);
                if (!active.current || job.current !== current) return;
                written.current += bytes.length;
                current.next++;
                current.writing = false;
                report("saving", current.total ? 70 + (29 * written.current) / current.total : 70);
                web.current?.injectJavaScript(
                  `window.acknowledgeChunk(${JSON.stringify(current.id)},${message.index});true;`
                );
              } else if (message.type === "done") {
                if (
                  !output.current ||
                  current.writing ||
                  message.chunks !== current.next ||
                  written.current < 44 ||
                  message.bytes !== written.current ||
                  (current.total && current.total !== written.current)
                )
                  throw new Error("Incomplete karaoke audio.");
                handle.current?.close();
                handle.current = null;
                report("ready", 100);
                finished.current = true;
                cache.set(source, output.current.uri);
                // Retain the most recent three prepared songs. All older files are app cache only.
                while (cache.size > 3) {
                  const oldest = cache.keys().next().value!;
                  const file = new File(cache.get(oldest)!);
                  cache.delete(oldest);
                  if (file.exists) file.delete();
                }
                handlers.current.onReady(source, output.current.uri);
              }
            } catch (error) {
              if (active.current) {
                job.current = null;
                handlers.current.onError(
                  source,
                  error instanceof Error ? error.message : "Could not prepare karaoke."
                );
              }
            }
          })();
        }}
      />
    </View>
  );
}
