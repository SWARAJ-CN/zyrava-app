/* global __dirname */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(path.resolve(__dirname, "../src", file), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("module", "exports", "require", ...Object.keys(globals), code)(
    module,
    module.exports,
    (name) => (Object.hasOwn(mocks, name) ? mocks[name] : require(name)),
    ...Object.values(globals)
  );
  return module.exports;
}

test("Expo audio publishes song artwork and native transport controls, then releases them", async () => {
  const calls = [];
  let status;
  const native = {
    addListener(_name, callback) {
      status = callback;
      return {
        remove() {
          calls.push(["unsubscribe"]);
        },
      };
    },
    setActiveForLockScreen(...args) {
      calls.push(["media", ...args]);
    },
    clearLockScreenControls() {
      calls.push(["clear"]);
    },
    play() {
      calls.push(["play"]);
    },
    pause() {
      calls.push(["pause"]);
    },
    remove() {
      calls.push(["remove"]);
    },
  };
  const { createGoAudioTransport, configureGoAudioMode } = load("lib/go-audio.ts", {
    expo: { isRunningInExpoGo: () => false },
    "expo-constants": { default: { executionEnvironment: "bare" }, __esModule: true },
    "expo-audio": {
      createAudioPlayer: () => native,
      setAudioModeAsync: async (mode) => calls.push(["mode", mode]),
    },
  });
  const events = [];
  const metadata = {
    title: "Song",
    artist: "Artist",
    albumTitle: "Album",
    artworkUrl: "https://example.test/cover.jpg",
  };
  const player = createGoAudioTransport(
    "song.mp3",
    {
      onLoad() {
        events.push("load");
      },
      onPlay() {
        events.push("play");
      },
      onPause() {
        events.push("pause");
      },
      onEnded() {
        events.push("end");
      },
      onError() {},
      onPositionChange() {},
    },
    { volume: 1, muted: false, rate: 1, metadata }
  );
  await configureGoAudioMode();
  assert.equal(calls.find(([kind]) => kind === "mode")[1].shouldPlayInBackground, true);
  assert.equal(calls.find(([kind]) => kind === "mode")[1].interruptionMode, "doNotMix");
  const media = calls.find(([kind]) => kind === "media");
  assert.equal(media[1], true);
  assert.deepEqual(media[2], metadata);
  assert.equal(media[3].showSeekForward, true);
  assert.equal(media[3].seekBackwardIntervalSeconds, 10);
  status({ isLoaded: true, duration: 180, currentTime: 0, playing: false, isBuffering: false });
  assert.deepEqual(events, ["load"], "initial paused status must not cancel autoplay intent");
  status({ isLoaded: true, duration: 180, currentTime: 1, playing: true, isBuffering: false });
  status({ isLoaded: true, duration: 180, currentTime: 2, playing: false, isBuffering: false });
  status({ isLoaded: true, duration: 180, currentTime: 2, playing: false, isBuffering: false });
  assert.deepEqual(events, ["load", "play", "pause"], "native pause is delivered once");
  player.handle.play();
  assert.equal(calls.filter(([kind]) => kind === "media").length, 1);
  player.dispose();
  assert.deepEqual(
    calls.slice(-4).map(([kind]) => kind),
    ["unsubscribe", "clear", "pause", "remove"]
  );
  status({ isLoaded: true, duration: 180, currentTime: 3, playing: true });
  assert.deepEqual(events, ["load", "play", "pause"]);
});

test("unsupported lock-screen controls do not prevent audio playback", async () => {
  let plays = 0;
  let mediaAttempts = 0;
  const { createGoAudioTransport, configureGoAudioMode } = load("lib/go-audio.ts", {
    expo: { isRunningInExpoGo: () => false },
    "expo-constants": { default: { executionEnvironment: "bare" }, __esModule: true },
    "expo-audio": {
      setAudioModeAsync: async () => {},
      createAudioPlayer: () => ({
        addListener: () => ({ remove() {} }),
        play() {
          plays++;
        },
        pause() {},
        remove() {},
        setActiveForLockScreen() {
          mediaAttempts++;
          throw new Error("older binary");
        },
      }),
    },
  });
  const player = createGoAudioTransport(
    "song.mp3",
    { onLoad() {}, onPlay() {}, onPause() {}, onEnded() {}, onError() {}, onPositionChange() {} },
    { volume: 1, muted: false, rate: 1 }
  );
  await configureGoAudioMode();
  player.handle.play();
  player.handle.pause();
  player.handle.play();
  assert.equal(plays, 2);
  assert.equal(mediaAttempts, 1, "unsupported controls must not retry on every resume");
  player.dispose();
});

test("failed player setup cannot publish stale media controls after audio mode resolves", async () => {
  let mediaCalls = 0;
  const { createGoAudioTransport, configureGoAudioMode } = load("lib/go-audio.ts", {
    expo: { isRunningInExpoGo: () => false },
    "expo-constants": { default: { executionEnvironment: "bare" }, __esModule: true },
    "expo-audio": {
      setAudioModeAsync: async () => {},
      createAudioPlayer: () => ({
        addListener() {
          throw new Error("unavailable");
        },
        remove() {},
        setActiveForLockScreen() {
          mediaCalls++;
        },
      }),
    },
  });
  const player = createGoAudioTransport(
    "song.mp3",
    { onLoad() {}, onPlay() {}, onPause() {}, onEnded() {}, onError() {}, onPositionChange() {} },
    { volume: 1, muted: false, rate: 1 }
  );
  await configureGoAudioMode();
  assert.equal(mediaCalls, 0);
  player.dispose();
});

test("Expo Go never binds the unavailable lock-screen service across tracks and resumes", async () => {
  for (const runtime of [
    { executionEnvironment: "storeClient", nativeExpoGo: false },
    { executionEnvironment: "bare", nativeExpoGo: true },
    { executionEnvironment: "standalone", nativeExpoGo: true },
    { executionEnvironment: "bare", appOwnership: "expo", nativeExpoGo: false },
    { executionEnvironment: undefined, nativeExpoGo: false },
  ]) {
    const calls = [];
    const failures = [];
    const { createGoAudioTransport, configureGoAudioMode } = load("lib/go-audio.ts", {
      expo: { isRunningInExpoGo: () => runtime.nativeExpoGo },
      "expo-constants": { default: runtime, __esModule: true },
      "expo-audio": {
        setAudioModeAsync: async (mode) => calls.push(["mode", mode]),
        createAudioPlayer: () => ({
          addListener: () => ({ remove() {} }),
          // Expo's native failure is logged asynchronously, not thrown. The
          // correct fix is never to reach this service in the Expo Go runtime.
          setActiveForLockScreen() {
            calls.push(["bind"]);
          },
          clearLockScreenControls() {
            calls.push(["clear"]);
          },
          play() {
            calls.push(["play"]);
          },
          pause() {
            calls.push(["pause"]);
          },
          remove() {
            calls.push(["remove"]);
          },
        }),
      },
    });
    for (const source of ["first.mp3", "next.mp3"]) {
      const transport = createGoAudioTransport(
        source,
        {
          onLoad() {},
          onPlay() {},
          onPause() {},
          onEnded() {},
          onError: (error) => failures.push(error),
          onPositionChange() {},
        },
        { volume: 1, muted: false, rate: 1, metadata: { title: source } }
      );
      transport.handle.play();
      await configureGoAudioMode();
      transport.handle.pause();
      transport.handle.play();
      transport.dispose();
    }
    assert.equal(calls.filter(([kind]) => kind === "bind" || kind === "clear").length, 0);
    assert.equal(calls.filter(([kind]) => kind === "play").length, 4);
    assert.equal(calls.filter(([kind]) => kind === "remove").length, 2);
    assert.equal(calls.find(([kind]) => kind === "mode")[1].shouldPlayInBackground, false);
    assert.equal(failures.length, 0);
  }
});

test("installed app waits for audio mode before activating native controls", async () => {
  let finishMode;
  let controls = 0;
  let plays = 0;
  const { createGoAudioTransport, configureGoAudioMode } = load("lib/go-audio.ts", {
    expo: { isRunningInExpoGo: () => false },
    "expo-constants": { default: { executionEnvironment: "standalone" }, __esModule: true },
    "expo-audio": {
      setAudioModeAsync: () =>
        new Promise((resolve) => {
          finishMode = resolve;
        }),
      createAudioPlayer: () => ({
        addListener: () => ({ remove() {} }),
        setActiveForLockScreen() {
          controls++;
        },
        clearLockScreenControls() {},
        play() {
          plays++;
        },
        pause() {},
        remove() {},
      }),
    },
  });
  const transport = createGoAudioTransport(
    "song.mp3",
    {
      onLoad() {},
      onPlay() {},
      onPause() {},
      onEnded() {},
      onError() {},
      onPositionChange() {},
    },
    { volume: 1, muted: false, rate: 1 }
  );
  transport.handle.play();
  assert.equal(controls, 0);
  await Promise.resolve();
  finishMode();
  await configureGoAudioMode();
  assert.equal(controls, 1);
  transport.handle.play();
  assert.equal(controls, 1);
  assert.equal(plays, 2);
  transport.dispose();
});
