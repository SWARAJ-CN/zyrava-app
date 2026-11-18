/* global __dirname */
const assert = require("node:assert/strict");
const { Buffer } = require("node:buffer");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const React = require("react");
const { act, create } = require("react-test-renderer");
const ts = require("typescript");
const vm = require("node:vm");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function loadWorker() {
  const load = (file, mocks = {}) => {
    const module = { exports: {} };
    const code = ts.transpileModule(
      readFileSync(path.resolve(__dirname, "../src/lib", file), "utf8"),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }
    ).outputText;
    new Function("module", "exports", "require", code)(
      module,
      module.exports,
      (name) => mocks[name]
    );
    return module.exports;
  };
  return load("karaoke-worker.ts", { "./karaoke": load("karaoke.ts") });
}
const worker = loadWorker();

function harness({ deferDownload = false, failWrite = false, realWorker = false } = {}) {
  const files = new Map();
  const intervals = new Map();
  let now = 0;
  let downloadOptions;
  const scripts = [];
  const inbound = [];
  let browser;
  if (realWorker) {
    const param = () => ({ value: 0, setTargetAtTime() {} });
    const node = () => ({
      gain: param(),
      frequency: param(),
      Q: param(),
      connect() {},
      disconnect() {},
      start() {},
    });
    class Offline {
      currentTime = 0;
      destination = {};
      createGain = node;
      createBiquadFilter = node;
      createChannelSplitter = node;
      createChannelMerger = node;
      createBufferSource = node;
      async decodeAudioData() {
        return { duration: 100000 / 22050, length: 100000, sampleRate: 22050 };
      }
      async startRendering() {
        return {
          length: 100000,
          sampleRate: 22050,
          getChannelData: () => new Float32Array(100000).fill(0.5),
        };
      }
    }
    browser = vm.createContext({
      window: {
        OfflineAudioContext: Offline,
        ReactNativeWebView: { postMessage: (json) => inbound.push(JSON.parse(json)) },
      },
      Uint8Array,
      DataView,
      atob,
      btoa,
      setInterval,
      clearInterval,
    });
    vm.runInContext(worker.karaokeWorkerHtml().split("<script>")[1].split("</script>")[0], browser);
  }
  const progress = [];
  const ready = [],
    errors = [];
  let currentJob;
  let nextIndex = 0;
  let downloads = 0,
    finishDownload;
  class File {
    constructor(...parts) {
      this.uri = parts.map((part) => part.uri ?? part).join("/");
    }
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return files.get(this.uri)?.length ?? 0;
    }
    create() {
      files.set(this.uri, Buffer.alloc(0));
    }
    delete() {
      files.delete(this.uri);
    }
    async base64() {
      return files.get(this.uri).toString("base64");
    }
    open() {
      let closed = false;
      return {
        close() {
          closed = true;
        },
        writeBytes: async (bytes) => {
          if (closed || failWrite) throw new Error("Write failed");
          files.set(this.uri, Buffer.concat([files.get(this.uri), Buffer.from(bytes)]));
        },
      };
    }
    static async downloadFileAsync(_source, destination, options) {
      downloadOptions = options;
      downloads++;
      if (deferDownload)
        await new Promise((resolve) => {
          finishDownload = resolve;
        });
      files.set(destination.uri, Buffer.from("encoded-audio"));
      return destination;
    }
  }
  class Directory {
    constructor(...parts) {
      this.uri = parts.join("/");
    }
    create() {}
    list() {
      return [...files.keys()]
        .filter((uri) => uri.startsWith(this.uri))
        .map((uri) => new File(uri));
    }
  }
  const WebView = React.forwardRef(function WebView(props, ref) {
    React.useImperativeHandle(
      ref,
      () => ({
        injectJavaScript(script) {
          scripts.push(script);
          if (browser) {
            vm.runInContext(script, browser);
            return;
          }
          vm.runInNewContext(script, {
            window: {
              prepareKaraoke(_encoded, job) {
                currentJob = job;
                nextIndex = 0;
              },
              acknowledgeChunk() {
                nextIndex++;
              },
            },
          });
        },
      }),
      []
    );
    return React.createElement("WebView", {
      ...props,
      getJob: () => currentJob,
      getIndex: () => nextIndex,
    });
  });
  const mocks = {
    "react-native": {
      View: "View",
      AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
    },
    "react-native-webview": { WebView },
    "expo-file-system": {
      File,
      Directory,
      FileMode: { WriteOnly: "w" },
      Paths: { cache: "cache" },
    },
    "@/lib/karaoke-worker": worker,
  };
  const module = { exports: {} };
  const code = ts.transpileModule(
    readFileSync(
      path.resolve(__dirname, "../src/components/providers/GoKaraokePreparation.tsx"),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }
  ).outputText;
  new Function("module", "exports", "require", "Date", "setInterval", "clearInterval", code)(
    module,
    module.exports,
    (key) => mocks[key] ?? require(key),
    class extends Date {
      static now() {
        return now;
      }
    },
    (callback) => {
      const id = Symbol();
      intervals.set(id, callback);
      return id;
    },
    (id) => intervals.delete(id)
  );
  const render = (source) =>
    React.createElement(module.exports.GoKaraokePreparation, {
      key: source,
      source,
      onReady: (...args) => ready.push(args),
      onError: (...args) => errors.push(args),
      onProgress: (_source, value) => progress.push(value),
    });
  return {
    files,
    inbound,
    scripts,
    ready,
    progress,
    errors,
    render,
    downloads: () => downloads,
    downloadProgress: (bytesWritten, totalBytes) =>
      downloadOptions.onProgress({ bytesWritten, totalBytes }),
    downloadAborted: () => downloadOptions.signal.aborted,
    advance: (ms) => {
      now += ms;
      for (const tick of intervals.values()) tick();
    },
    finishDownload: () => finishDownload(),
  };
}
const send = async (renderer, message) =>
  act(async () => {
    const view = renderer.root.findByType("WebView");
    const defaults =
      message.type === "ready"
        ? {}
        : {
            job: view.props.getJob(),
            index: view.props.getIndex(),
            bytes: message.data ? Buffer.from(message.data, "base64").length : undefined,
            chunks: view.props.getIndex(),
          };
    await view.props.onMessage({
      nativeEvent: { data: JSON.stringify({ ...defaults, ...message }) },
    });
  });

test("Expo Go preparation writes acknowledged chunks, reuses its cache, and deletes partial files", async () => {
  const h = harness();
  let renderer;
  await act(() => {
    renderer = create(h.render("https://test/song.mp3"));
  });
  await send(renderer, { type: "ready", version: 4 });
  assert.match(h.scripts[0], /prepareKaraoke/);
  assert.equal(h.downloads(), 1);
  await send(renderer, { type: "chunk", data: Buffer.alloc(44).toString("base64") });
  assert.match(h.scripts.at(-1), /acknowledgeChunk/);
  await send(renderer, { type: "done", bytes: 44 });
  assert.equal(h.ready.length, 1);
  assert.equal(h.files.get(h.ready[0][1]).length, 44);
  assert.equal(h.errors.length, 0);
  await act(() => renderer.unmount());
  await act(() => {
    renderer = create(h.render("https://test/song.mp3"));
  });
  assert.equal(h.ready.length, 2);
  assert.equal(h.downloads(), 1, "prepared audio does not download again");
  await act(() => renderer.update(h.render("https://test/other.mp3")));
  await send(renderer, { type: "ready", version: 4 });
  await send(renderer, { type: "chunk", data: Buffer.alloc(10).toString("base64") });
  await send(renderer, { type: "done", bytes: 44 });
  assert.match(h.errors.at(-1)[1], /Incomplete/);
  await act(() => renderer.unmount());
  assert.equal(h.files.size, 1, "partial output and downloaded input are deleted");
});

test("cancelling preparation during download cannot return stale audio", async () => {
  const h = harness({ deferDownload: true });
  let renderer;
  await act(() => {
    renderer = create(h.render("https://test/slow.mp3"));
  });
  await send(renderer, { type: "ready", version: 4 });
  await act(() => renderer.unmount());
  await act(async () => h.finishDownload());
  assert.equal(h.files.size, 0);
  assert.equal(h.scripts.length, 0);
  assert.equal(h.ready.length, 0);
  assert.equal(h.errors.length, 0);
});

test("an old WebView processor cannot start a preparation job", async () => {
  const h = harness();
  let renderer;
  await act(() => {
    renderer = create(h.render("https://test/song.mp3"));
  });
  await send(renderer, { type: "ready", version: 1 });
  assert.match(h.errors[0][1], /Reload the app/);
  assert.equal(h.downloads(), 0);
  assert.equal(h.scripts.length, 0);
  await act(() => renderer.unmount());
});

test("late chunks from an older job are ignored before and after the writer opens", async () => {
  const h = harness({ deferDownload: true });
  let renderer;
  await act(() => {
    renderer = create(h.render("https://test/song.mp3"));
  });
  const stale = {
    type: "chunk",
    job: "retired-job",
    index: 0,
    data: Buffer.alloc(44).toString("base64"),
  };
  await send(renderer, stale);
  await send(renderer, { type: "ready", version: 4 });
  await send(renderer, stale);
  assert.equal(h.errors.length, 0);
  await act(async () => h.finishDownload());
  await send(renderer, stale);
  const data = Buffer.alloc(44, 5);
  await send(renderer, { type: "chunk", data: data.toString("base64") });
  await send(renderer, { type: "done", bytes: 44 });
  assert.equal(h.errors.length, 0);
  assert.deepEqual(h.files.get(h.ready[0][1]), data);
  await act(() => renderer.unmount());
});

test("full-size PCM chunks are written once, in order, before completing the file", async () => {
  const h = harness();
  let renderer;
  await act(() => {
    renderer = create(h.render("https://test/song.mp3"));
  });
  await send(renderer, { type: "ready", version: 4 });
  const parts = [
    Buffer.alloc(44, 1),
    Buffer.alloc(32768, 2),
    Buffer.alloc(32768, 3),
    Buffer.alloc(100, 4),
  ];
  for (let index = 0; index < parts.length; index++) {
    const message = { type: "chunk", index, data: parts[index].toString("base64") };
    await send(renderer, message);
    await send(renderer, message); // a repeated delivery cannot append duplicate audio
  }
  await send(renderer, { type: "done", bytes: parts.reduce((sum, part) => sum + part.length, 0) });
  assert.equal(h.errors.length, 0);
  assert.deepEqual(h.files.get(h.ready[0][1]), Buffer.concat(parts));
  await act(() => renderer.unmount());
});

test("truncated and out-of-order chunks fail without acknowledging corrupt audio", async () => {
  for (const [message, expected] of [
    [{ index: 0, bytes: 44, data: "AA==" }, /truncated/],
    [{ index: 2, bytes: 44, data: Buffer.alloc(44).toString("base64") }, /out of order/],
  ]) {
    const h = harness();
    let renderer;
    await act(() => {
      renderer = create(h.render("https://test/song.mp3"));
    });
    await send(renderer, { type: "ready", version: 4 });
    await send(renderer, { type: "chunk", ...message });
    assert.match(h.errors[0][1], expected);
    assert.equal(h.scripts.length, 1, "failed data is never acknowledged");
    assert.equal(h.ready.length, 0);
    await act(() => renderer.unmount());
    assert.equal(h.files.size, 0);
  }
});

test("the actual WebView worker streams a complete WAV through the actual file receiver", async () => {
  const h = harness({ realWorker: true });
  let renderer;
  await act(() => {
    renderer = create(h.render("https://test/song.mp3"));
  });
  const delivered = [];
  for (let step = 0; step < 100 && !h.ready.length && !h.errors.length; step++) {
    while (h.inbound.length) {
      const message = h.inbound.shift();
      delivered.push(message);
      await send(renderer, message);
    }
    await act(async () => new Promise((resolve) => setImmediate(resolve)));
  }
  assert.deepEqual(h.errors, []);
  assert.equal(h.ready.length, 1);
  const wav = h.files.get(h.ready[0][1]);
  assert.equal(wav.length, 44 + 100000 * 4);
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert.equal(wav.readUInt32LE(40), wav.length - 44);
  assert.equal(wav.readInt16LE(44), 16384);
  assert.equal(wav.readInt16LE(wav.length - 2), 16384);
  const chunks = delivered.filter((message) => message.type === "chunk");
  assert.deepEqual(
    chunks.map((message) => message.index),
    [0, 1, 2, 3, 4]
  );
  assert.ok(chunks.every((message) => message.bytes <= worker.KARAOKE_CHUNK_BYTES));
  assert.deepEqual(h.progress.at(-1), { stage: "ready", percent: 100 });
  assert.ok(h.progress.some((value) => value.stage === "processing"));
  assert.ok(
    h.progress.some(
      (value) => value.stage === "saving" && value.percent > 70 && value.percent < 100
    )
  );
  assert.ok(
    h.progress.every((value, index) => !index || value.percent >= h.progress[index - 1].percent)
  );
  await act(() => renderer.unmount());
});

test("a progressing download survives two minutes; a stalled download is aborted", async () => {
  const h = harness({ deferDownload: true });
  let renderer;
  await act(() => {
    renderer = create(h.render("https://test/slow.mp3"));
  });
  await send(renderer, { type: "ready", version: worker.KARAOKE_WORKER_VERSION });
  for (let bytes = 100; bytes <= 400; bytes += 100) {
    await act(() => h.downloadProgress(bytes, 1000));
    await act(() => h.advance(50000));
    assert.deepEqual(h.errors, []);
  }
  assert.deepEqual(h.progress.at(-1), { stage: "downloading", percent: 10 });
  await act(() => h.advance(10001));
  assert.match(h.errors[0][1], /download stopped responding/);
  assert.equal(h.downloadAborted(), true);
  await act(() => renderer.unmount());
  await act(async () => h.finishDownload());
  assert.equal(h.files.size, 0);
});

test("writing audio can take more than two minutes while chunks continue to arrive", async () => {
  const h = harness();
  let renderer;
  await act(() => {
    renderer = create(h.render("https://test/song.mp3"));
  });
  await send(renderer, { type: "ready", version: worker.KARAOKE_WORKER_VERSION });
  const total = 44 + 4 * 32768;
  await send(renderer, { type: "progress", stage: "saving", percent: 70, totalBytes: total });
  for (const size of [44, 32768, 32768, 32768, 32768]) {
    await send(renderer, { type: "chunk", data: Buffer.alloc(size).toString("base64") });
    await act(() => h.advance(45000));
    assert.deepEqual(h.errors, []);
  }
  assert.equal(h.progress.at(-1).percent, 99);
  await send(renderer, { type: "done", bytes: total });
  assert.equal(h.progress.at(-1).percent, 100);
  assert.equal(h.ready.length, 1);
  await act(() => renderer.unmount());
});

test("a genuinely stalled decoder produces one stage-specific error", async () => {
  const h = harness();
  let renderer;
  await act(() => {
    renderer = create(h.render("https://test/song.mp3"));
  });
  await send(renderer, { type: "ready", version: worker.KARAOKE_WORKER_VERSION });
  await send(renderer, { type: "progress", stage: "decoding", percent: 30 });
  await act(() => h.advance(179000));
  assert.deepEqual(h.errors, []);
  await act(() => h.advance(1000));
  assert.match(h.errors[0][1], /decoding stopped responding/);
  await act(() => h.advance(60000));
  assert.equal(h.errors.length, 1);
  await act(() => renderer.unmount());
});
