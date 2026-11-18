/* global __dirname */
const assert = require("node:assert/strict");
const { Buffer } = require("node:buffer");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
function load(name, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(
    readFileSync(path.resolve(__dirname, "../src/lib", name), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }
  ).outputText;
  new Function("module", "exports", "require", code)(module, module.exports, (key) => mocks[key]);
  return module.exports;
}
const karaoke = load("karaoke.ts");
// Hermes does not expose function bodies. Preparation must work with opaque functions.
karaoke.createKaraokeStage.toString = () => {
  throw new Error("Hermes function source unavailable");
};
const { karaokeWorkerHtml, KARAOKE_WORKER_VERSION } = load("karaoke-worker.ts", {
  "./karaoke": karaoke,
});

test("Expo Go worker transfers a complete stereo WAV with sample count and timing preserved", async () => {
  const messages = [];
  const chunks = [];
  const param = () => ({
    value: 0,
    setTargetAtTime(value) {
      this.value = value;
    },
  });
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
      return { duration: 2 / 22050, length: 2, sampleRate: 22050 };
    }
    async startRendering() {
      return {
        length: 2,
        sampleRate: 22050,
        getChannelData: (channel) => new Float32Array(channel ? [0.25, -2] : [1.5, -0.5]),
      };
    }
  }
  const window = {
    OfflineAudioContext: Offline,
    ReactNativeWebView: {
      postMessage(json) {
        const message = JSON.parse(json);
        messages.push(message);
        if (message.type === "chunk") {
          chunks.push(Buffer.from(message.data, "base64"));
          queueMicrotask(() => window.acknowledgeChunk(message.job, message.index));
        }
      },
    },
  };
  const script = karaokeWorkerHtml().split("<script>")[1].split("</script>")[0];
  vm.runInNewContext(script, {
    window,
    Uint8Array,
    DataView,
    atob,
    btoa,
    setInterval,
    clearInterval,
  });
  await window.prepareKaraoke("AA==", "test-job");
  assert.deepEqual(messages[0], { type: "ready", version: KARAOKE_WORKER_VERSION });
  const file = Buffer.concat(chunks);
  assert.equal(file.subarray(0, 4).toString(), "RIFF");
  assert.equal(file.subarray(8, 12).toString(), "WAVE");
  assert.equal(file.readUInt32LE(24), 22050);
  assert.equal(file.readUInt16LE(22), 2);
  assert.equal(file.readUInt32LE(40), 8);
  assert.equal(file.length, 52);
  assert.deepEqual(
    [44, 46, 48, 50].map((at) => file.readInt16LE(at)),
    [32767, 8192, -16383, -32767]
  );
  assert.deepEqual(messages.at(-1), {
    type: "done",
    bytes: file.length,
    job: "test-job",
    chunks: 2,
  });
  const count = messages.length;
  await window.prepareKaraoke("AA==", "test-job");
  assert.equal(messages.length, count, "duplicate ready events cannot run a second processing job");
});

test("Expo Go worker reports unsupported Web Audio without emitting partial audio", async () => {
  const messages = [];
  const window = { ReactNativeWebView: { postMessage: (json) => messages.push(JSON.parse(json)) } };
  const script = karaokeWorkerHtml().split("<script>")[1].split("</script>")[0];
  vm.runInNewContext(script, {
    window,
    Uint8Array,
    DataView,
    atob,
    btoa,
    setInterval,
    clearInterval,
  });
  await window.prepareKaraoke("AA==", "test-job");
  assert.equal(messages.at(-1).type, "error");
  assert.equal(
    messages.some((message) => message.type === "chunk"),
    false
  );
});
