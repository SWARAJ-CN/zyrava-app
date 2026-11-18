/* global __dirname */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(path.resolve(__dirname, "../src", file), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("module", "exports", "require", code)(module, module.exports, (name) =>
    Object.hasOwn(mocks, name) ? mocks[name] : require(name)
  );
  return module.exports;
}
const eq = load("lib/go-equalizer.ts", {
  "./go-spatial": load("lib/go-spatial.ts"),
  "./karaoke": load("lib/karaoke.ts"),
});

test("EQ bridge keeps pending settings, sends live changes, and ignores disposed-track messages", () => {
  const bridge = eq.createEqualizerBridge(),
    commands = [],
    loads = [],
    events = [];
  const callbacks = {
    onLoad: (d) => events.push(["load", d]),
    onPlay() {},
    onPause() {},
    onEnded() {},
    onError: (e) => events.push(["error", e.message]),
    onPositionChange: (t) => events.push(["time", t]),
  };
  bridge.attach({
    post: (c) => commands.push(c),
    load: (id, source) => loads.push({ id, source }),
    cancel() {},
  });
  const first = bridge.createTransport("one.mp3", callbacks, { volume: 1, muted: false, rate: 1 });
  first.handle.play();
  first.handle.setVolume(0.2);
  first.handle.seekToTime(23);
  bridge.setGains([6, NaN, 20]);
  bridge.setSpace("wide");
  bridge.setKaraoke(true);
  bridge.begin(loads[0].id);
  const begin = commands.at(-1);
  assert.equal(begin.playing, true);
  assert.equal(begin.space, "wide");
  assert.equal(begin.karaoke, true);
  assert.equal(begin.volume, 0.2);
  assert.equal(begin.position, 23);
  assert.deepEqual(begin.gains, [6, 0, 12, 0, 0, 0, 0, 0, 0, 0]);
  bridge.receive({ id: loads[0].id, type: "loaded", duration: 180 });
  bridge.receive({ id: loads[0].id, type: "loaded", duration: 180 });
  assert.deepEqual(events, [["load", 180]]);
  const second = bridge.createTransport("two.mp3", callbacks, { volume: 1, muted: false, rate: 1 });
  first.dispose();
  bridge.receive({ id: loads[0].id, type: "error", message: "late failure" });
  bridge.receive({ id: loads[1].id, type: "position", time: 10 });
  assert.deepEqual(events, [
    ["load", 180],
    ["time", 10],
  ]);
  second.dispose();
  bridge.receive({ id: loads[1].id, type: "error", message: "disposed" });
  assert.equal(events.length, 2);
});

test("WebView streams remote audio and routes local blobs through the same live effects graph", async () => {
  const nodes = [],
    messages = [];
  const timers = new Map();
  let timerSerial = 0;
  const parameter = () => ({
    value: 0,
    setTargetAtTime(value) {
      this.value = value;
    },
  });
  const node = (kind) => {
    const value = {
      kind,
      gain: parameter(),
      frequency: parameter(),
      Q: parameter(),
      delayTime: parameter(),
      pan: parameter(),
      positionX: parameter(),
      positionY: parameter(),
      positionZ: parameter(),
      start() {
        this.started = true;
      },
      stop() {
        this.stopped = true;
      },
      connections: [],
      disconnect() {
        this.connections = [];
      },
      connect(next) {
        this.connections.push(next);
      },
    };
    nodes.push(value);
    return value;
  };
  class Context {
    currentTime = 0;
    destination = { kind: "speakers" };
    createBiquadFilter() {
      return node("filter");
    }
    createGain() {
      return node("gain");
    }
    createMediaElementSource() {
      return node("source");
    }
    createChannelSplitter() {
      return node("splitter");
    }
    createChannelMerger() {
      return node("merger");
    }
    createDelay() {
      return node("delay");
    }
    createPanner() {
      return node("panner");
    }
    createStereoPanner() {
      return node("panner");
    }
    createOscillator() {
      return node("oscillator");
    }
    async resume() {}
  }
  let mediaLoads = 0,
    mediaPlays = 0;
  const media = {
    duration: 180,
    currentTime: 0,
    paused: true,
    pause() {
      this.paused = true;
    },
    play() {
      mediaPlays++;
      this.paused = false;
      this.onplaying?.();
      return Promise.resolve();
    },
    removeAttribute() {},
    load() {
      mediaLoads++;
    },
  };
  const window = {
    AudioContext: Context,
    ReactNativeWebView: { postMessage: (raw) => messages.push(JSON.parse(raw)) },
  };
  vm.runInNewContext(eq.equalizerPreviewHtml().split("<script>")[1].split("</script>")[0], {
    window,
    document: { createElement: () => media, body: { appendChild() {} } },
    Uint8Array,
    Blob,
    atob,
    setInterval() {},
    setTimeout(fn, ms) {
      const id = ++timerSerial;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    URL: { createObjectURL: () => "blob:local-track", revokeObjectURL() {} },
  });
  assert.equal(messages[0].type, "ready");
  const send = (command) => window.zyravaEqCommand({ id: 1, ...command });
  const gains = [0, 0, 0, 0, 0, 6, 0, 0, 0, 0];
  send({ type: "begin", volume: 0.4, muted: false, rate: 1, gains, playing: true });
  const filters = nodes.filter((n) => n.kind === "filter" && n.type === "peaking");
  assert.equal(filters.length, 10);
  assert.deepEqual(
    filters.map((f) => f.frequency.value),
    [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
  );
  assert.ok(filters.every((f) => f.type === "peaking" && f.Q.value === 1));
  assert.equal(nodes.find((n) => n.kind === "source").connections[0], filters[0]);
  filters.slice(0, -1).forEach((f, i) => assert.equal(f.connections[0], filters[i + 1]));
  assert.equal(filters[5].gain.value, 6);
  assert.ok(
    nodes.filter((n) => n.kind === "gain")[0].gain.value < 1,
    "positive boosts use headroom compensation"
  );
  send({ type: "chunk", index: 0, data: btoa("audio-bytes") });
  send({ type: "finish", bytes: 11, chunks: 1 });
  assert.equal(
    media.src,
    "blob:local-track",
    "CDN data plays from a same-origin blob through the graph"
  );
  media.onloadedmetadata();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(media.paused, false);
  send({ type: "eq", gains: Array(10).fill(-3) });
  assert.ok(filters.every((f) => f.gain.value === -3));
  assert.equal(
    nodes.filter((n) => n.kind === "source").length,
    1,
    "EQ changes reuse the current media source"
  );
  const loadsBefore = mediaLoads,
    playsBefore = mediaPlays,
    graphSize = nodes.length;
  for (const mode of load("lib/go-spatial.ts").GO_SPACE_MODES) {
    send({ type: "space", mode });
    send({ type: "eq", gains: Array(10).fill(mode === "off" ? 0 : 4) });
  }
  send({ type: "space", mode: "off" });
  assert.equal(mediaLoads, loadsBefore, "Space and EQ never reload the media");
  assert.equal(mediaPlays, playsBefore, "Space and EQ never restart playback");
  assert.equal(media.paused, false);
  assert.ok(
    nodes.slice(graphSize).every((n) => n.connections.length === 0),
    "all previous Space paths are disconnected"
  );
  assert.ok(
    nodes.filter((n) => n.kind === "oscillator").every((n) => n.stopped),
    "orbit LFOs stop on mode change"
  );
  assert.ok(!messages.some((m) => m.type === "error"));
  send({ type: "space", mode: "8d" });
  send({ type: "stop" });
  send({ type: "begin", volume: 0.4, muted: false, rate: 1, gains, playing: true });
  send({ type: "stream", source: "https://cdn.example/song.mp4" });
  assert.equal(media.src, "https://cdn.example/song.mp4");
  assert.equal(
    media.crossOrigin,
    "anonymous",
    "CORS is set before remote playback so Web Audio cannot silently bypass effects"
  );
  media.onloadedmetadata();
  media.oncanplay();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(media.paused, false, "remote media plays without any chunk/finish messages");
  const remoteLoads = mediaLoads;
  send({ type: "karaoke", enabled: true });
  assert.ok(
    nodes.some((n) => n.gain.value === -0.9),
    "live karaoke applies center reduction to the playing stream"
  );
  send({ type: "karaoke", enabled: false });
  assert.ok(!nodes.some((n) => n.gain.value === -0.9), "switching off restores original audio");
  send({ type: "eq", gains: Array(10).fill(0) });
  send({ type: "space", mode: "wide" });
  assert.equal(mediaLoads, remoteLoads, "streaming still reuses the same player for effects");
  send({ type: "seek", position: 60 });
  assert.equal(media.currentTime, 60);
  send({ type: "stop" });
  assert.equal(media.paused, true);
  assert.ok(
    nodes.filter((n) => n.kind === "oscillator").every((n) => n.stopped),
    "stop releases all oscillators"
  );
  assert.equal(timers.size, 0, "stop cancels startup timeout");
  send({ type: "begin", volume: 1, muted: false, rate: 1, gains, playing: true });
  send({ type: "stream", source: "https://cdn.example/stalled.mp4" });
  const deadline = [...timers.values()].find((t) => t.ms === 8000);
  assert.ok(deadline, "stream startup has a bounded deadline");
  media.onloadedmetadata();
  assert.equal(timers.size, 1, "metadata alone does not mean the stream is playable");
  deadline.fn();
  assert.equal(media.paused, true, "a stalled stream is silenced before fallback");
  assert.equal(messages.at(-1).type, "error");
  assert.equal(timers.size, 0);
});

test("EQ host starts remote streams immediately and cancels stale local-file transfers", async () => {
  const React = require("react");
  const { act, create } = require("react-test-renderer");
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const files = new Map(),
    commands = [],
    availability = [];
  let view;
  class File {
    constructor(...parts) {
      this.uri = parts.map((p) => p.uri || p).join("/");
      this.exists = false;
      this.size = 6;
      files.set(this.uri, this);
    }
    delete() {
      this.exists = false;
      this.deleted = true;
    }
    open() {
      let offset = 0;
      this.opened = true;
      return {
        readBytes: async (count) => {
          const bytes = new Uint8Array(Math.min(count, 6 - offset)).fill(1);
          offset += bytes.length;
          return bytes;
        },
        close: () => {
          this.closed = true;
        },
      };
    }
    static downloadFileAsync() {
      throw new Error("Remote playback must never download the whole file");
    }
  }

  const WebView = React.forwardRef(function Web(props, ref) {
    view = props;
    React.useImperativeHandle(ref, () => ({
      injectJavaScript: (script) =>
        commands.push(JSON.parse(script.match(/^window\.zyravaEqCommand\((.*)\);true;$/s)[1])),
    }));
    return React.createElement("WebView", props);
  });
  const { GoEqualizerHost } = load("components/providers/GoEqualizerHost.tsx", {
    "react-native": { View: "View" },
    "react-native-webview": { WebView },
    "expo-file-system": {
      File,
      FileMode: { ReadOnly: 1 },
    },
    "@/lib/go-equalizer": eq,
  });
  const bridge = eq.createEqualizerBridge();
  const callbacks = {
    onLoad() {},
    onPlay() {},
    onPause() {},
    onEnded() {},
    onError(error) {
      throw error;
    },
    onPositionChange() {},
  };
  let renderer;
  await act(() => {
    renderer = create(
      React.createElement(GoEqualizerHost, {
        bridge,
        onAvailable: (value) => availability.push(value),
      })
    );
  });
  const message = (payload) => view.onMessage({ nativeEvent: { data: JSON.stringify(payload) } });
  try {
    await act(() => message({ type: "ready", version: eq.EQ_PREVIEW_VERSION }));
    assert.deepEqual(availability, [true]);
    await act(() => message({ type: "ready", version: eq.EQ_PREVIEW_VERSION }));
    assert.deepEqual(availability, [true], "duplicate readiness must not reattach the player");
    const remote = bridge.createTransport("https://example.test/song.mp4", callbacks, {
      volume: 1,
      muted: false,
      rate: 1,
    });
    assert.equal(
      commands.at(-1).type,
      "stream",
      "stream is sent synchronously, without waiting for file IO"
    );
    assert.equal(commands.at(-1).source, "https://example.test/song.mp4");
    assert.equal(files.size, 0, "remote songs never use the download/byte bridge");
    remote.dispose();
    const first = bridge.createTransport("file://one.mp3", callbacks, {
      volume: 1,
      muted: false,
      rate: 1,
    });
    first.dispose();
    assert.equal(files.get("file://one.mp3").closed, true);
    const second = bridge.createTransport("file://two.mp3", callbacks, {
      volume: 1,
      muted: false,
      rate: 1,
    });
    await act(() => Promise.resolve());
    assert.equal(
      commands.filter((c) => c.type === "chunk").length,
      1,
      "cancelled reads cannot reach the next track"
    );
    const chunk = commands.find((c) => c.type === "chunk");
    assert.ok(chunk);
    assert.equal(
      commands.filter((c) => c.type === "finish").length,
      0,
      "wait for the WebView acknowledgement"
    );
    await act(() => message({ type: "ack", id: chunk.id, index: chunk.index }));
    await act(() => message({ type: "ack", id: chunk.id, index: chunk.index }));
    assert.equal(commands.filter((c) => c.type === "finish").length, 1);
    assert.equal(files.get("file://two.mp3").closed, true);
    assert.ok(
      [...files.values()].every((f) => !f.deleted),
      "original files are preserved"
    );
    await act(() => view.onRenderProcessGone());
    assert.equal(commands.at(-1).type, "stop", "failed host stops playback before fallback");
    await act(() => view.onError());
    await act(() => message({ type: "ready", version: eq.EQ_PREVIEW_VERSION }));
    assert.deepEqual(availability, [true, false], "late readiness cannot reactivate a failed host");
    second.dispose();
  } finally {
    await act(() => renderer.unmount());
  }
});

test("effects host times out once and ignores late readiness instead of leaving playback stuck", async (t) => {
  const React = require("react");
  const { act, create } = require("react-test-renderer");
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const availability = [];
  let view;
  const WebView = (props) => {
    view = props;
    return React.createElement("WebView", props);
  };
  const { GoEqualizerHost } = load("components/providers/GoEqualizerHost.tsx", {
    "react-native": { View: "View" },
    "react-native-webview": { WebView },
    "expo-file-system": {},
    "@/lib/go-equalizer": eq,
  });
  let renderer;
  await act(() => {
    renderer = create(
      React.createElement(GoEqualizerHost, {
        bridge: eq.createEqualizerBridge(),
        onAvailable: (value) => availability.push(value),
      })
    );
  });
  try {
    await act(() => t.mock.timers.tick(8000));
    assert.deepEqual(availability, [false]);
    await act(() =>
      view.onMessage({
        nativeEvent: { data: JSON.stringify({ type: "ready", version: eq.EQ_PREVIEW_VERSION }) },
      })
    );
    await act(() => view.onError());
    assert.deepEqual(availability, [false]);
  } finally {
    await act(() => renderer.unmount());
    t.mock.timers.reset();
  }
});
