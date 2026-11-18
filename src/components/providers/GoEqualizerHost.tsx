// @refresh reset
import { useEffect, useRef } from "react";
import { View } from "react-native";
import { File, FileMode, type FileHandle } from "expo-file-system";
import { WebView } from "react-native-webview";
import {
  EQ_PREVIEW_CHUNK,
  EQ_PREVIEW_LIMIT,
  EQ_PREVIEW_VERSION,
  equalizerPreviewHtml,
  type EqualizerBridge,
  type EqualizerCommand,
} from "@/lib/go-equalizer";

const HTML = { html: equalizerPreviewHtml() };
/** Remote tracks stream directly; only device-local audio crosses the byte bridge. */
export function GoEqualizerHost({
  bridge,
  onAvailable,
}: {
  bridge: EqualizerBridge;
  onAvailable: (ready: boolean) => void;
}) {
  const web = useRef<WebView<unknown>>(null);
  const available = useRef(onAvailable);
  useEffect(() => {
    available.current = onAvailable;
  }, [onAvailable]);
  const alive = useRef(true);
  const terminal = useRef(false);
  const attached = useRef(false);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const job = useRef<{
    id: number;
    handle?: FileHandle;
    index: number;
    offset: number;
    total: number;
    mime: string;
    timer?: ReturnType<typeof setTimeout>;
  } | null>(null);
  const post = (command: EqualizerCommand) =>
    web.current?.injectJavaScript(`window.zyravaEqCommand(${JSON.stringify(command)});true;`);
  const cancel = () => {
    const item = job.current;
    job.current = null;
    if (!item) return;
    clearTimeout(item.timer);
    try {
      item.handle?.close();
    } catch {
      /* released */
    }
  };
  const fail = (id: number, message: string) => {
    if (!alive.current || job.current?.id !== id) return;
    cancel();
    bridge.receive({ type: "error", id, message });
  };
  const nextChunk = async () => {
    const item = job.current;
    if (!item?.handle) return;
    try {
      if (item.offset >= item.total) {
        post({
          type: "finish",
          id: item.id,
          bytes: item.total,
          chunks: item.index,
          mime: item.mime,
        });
        cancel();
        return;
      }
      const bytes = await item.handle.readBytes(
        Math.min(EQ_PREVIEW_CHUNK, item.total - item.offset)
      );
      if (job.current !== item) return;
      if (!bytes.length) throw new Error("The EQ audio file ended early.");
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      item.offset += bytes.length;
      post({ type: "chunk", id: item.id, index: item.index, data: btoa(binary) });
    } catch (error) {
      fail(item.id, error instanceof Error ? error.message : "EQ could not read this track.");
    }
  };
  const load = async (id: number, source: string) => {
    cancel();
    const item: NonNullable<typeof job.current> = {
      id,
      index: 0,
      offset: 0,
      total: 0,
      mime: /\.wav(?:$|\?)/i.test(source)
        ? "audio/wav"
        : /\.(m4a|mp4)(?:$|\?)/i.test(source)
          ? "audio/mp4"
          : "audio/mpeg",
    };
    job.current = item;
    item.timer = setTimeout(
      () => fail(id, "EQ preview took too long to load. Try again on a faster connection."),
      90_000
    );
    bridge.receive({ id, type: "buffering", value: true });
    try {
      if (/^https?:\/\//i.test(source)) {
        // Start the media request immediately. Do not download an entire song
        // or shuttle its bytes through JS before the listener hears anything.
        if (bridge.begin(id)) post({ type: "stream", id, source });
        cancel();
        return;
      }
      if (!/^(file|content):\/\//.test(source)) throw new Error("Unsupported audio source.");
      const input = new File(source);
      if (input.size <= 0 || input.size > EQ_PREVIEW_LIMIT)
        throw new Error("EQ preview supports tracks up to 25 MB.");
      item.total = input.size;
      item.handle = input.open(FileMode.ReadOnly);
      if (!bridge.begin(id)) {
        cancel();
        return;
      }
      await nextChunk();
    } catch (error) {
      fail(id, error instanceof Error ? error.message : "EQ could not load this track.");
    }
  };
  const unavailable = () => {
    if (!alive.current || terminal.current) return;
    terminal.current = true;
    if (readyTimer.current) clearTimeout(readyTimer.current);
    bridge.detach();
    cancel();
    available.current(false);
  };
  useEffect(() => {
    alive.current = true;
    terminal.current = false;
    attached.current = false;
    readyTimer.current = setTimeout(unavailable, 8000);
    return () => {
      alive.current = false;
      if (readyTimer.current) clearTimeout(readyTimer.current);
      bridge.detach();
    };
    // Host identity is stable; callbacks read their latest value through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
    >
      <WebView
        ref={web}
        source={HTML}
        originWhitelist={["*"]}
        javaScriptEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        scrollEnabled={false}
        onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
        onError={unavailable}
        onContentProcessDidTerminate={unavailable}
        onRenderProcessGone={() => {
          unavailable();
          return true;
        }}
        onMessage={(event) => {
          if (!alive.current || terminal.current) return;
          try {
            const message = JSON.parse(event.nativeEvent.data);
            if (message.type === "ready") {
              if (attached.current) return;
              if (message.version !== EQ_PREVIEW_VERSION) {
                unavailable();
                return;
              }
              if (readyTimer.current) clearTimeout(readyTimer.current);
              attached.current = true;
              bridge.attach({ load: (id, source) => void load(id, source), post, cancel });
              available.current(true);
            } else if (message.type === "ack") {
              const item = job.current;
              if (item && message.id === item.id && message.index === item.index) {
                item.index++;
                void nextChunk();
              }
            } else if (message.type === "error" && !message.id) unavailable();
            else bridge.receive(message);
          } catch {
            /* Ignore malformed or stale WebView messages. */
          }
        }}
      />
    </View>
  );
}
