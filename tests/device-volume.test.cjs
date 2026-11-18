/* global __dirname */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const React = require("react");
const { act, create } = require("react-test-renderer");
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

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function harness({ expoGo = false, initial, read, write } = {}) {
  let listener, appState, value;
  const writes = [];
  let removals = 0,
    reads = 0,
    imports = 0;
  const manager = {
    getVolume() {
      reads++;
      return read ? read(reads) : Promise.resolve(initial ?? { volume: 0.6 });
    },
    setVolume(next, options) {
      writes.push([next, options]);
      return write?.(next) ?? Promise.resolve();
    },
    addVolumeListener(fn) {
      listener = fn;
      return {
        remove() {
          removals++;
        },
      };
    },
  };
  const mocks = {
    "react-native": {
      Platform: { OS: "android" },
      NativeModules: { VolumeManager: {} },
      AppState: {
        addEventListener(_type, fn) {
          appState = fn;
          return {
            remove() {
              removals++;
            },
          };
        },
      },
    },
    "expo-constants": {
      __esModule: true,
      default: { executionEnvironment: expoGo ? "storeClient" : "bare" },
    },
  };
  Object.defineProperty(mocks, "react-native-volume-manager", {
    get() {
      imports++;
      return { VolumeManager: manager };
    },
  });
  const { useDeviceVolume } = load("hooks/useDeviceVolume.ts", mocks);
  function Probe() {
    value = useDeviceVolume();
    return null;
  }
  let renderer;
  await act(() => {
    renderer = create(React.createElement(Probe));
  });
  return {
    get value() {
      return value;
    },
    writes,
    get reads() {
      return reads;
    },
    get imports() {
      return imports;
    },
    get removals() {
      return removals;
    },
    emit: (result) => listener(result),
    foreground: () => appState("active"),
    unmount: () => renderer.unmount(),
  };
}
test("system volume reads without changing it, follows media buttons and removes listeners", async () => {
  const h = await harness();
  assert.equal(h.value.volume, 0.6);
  assert.deepEqual(h.writes, []);
  await act(() => h.emit({ volume: 0.3, type: "music" }));
  assert.equal(h.value.volume, 0.3);
  await act(() => h.emit({ volume: 0.9, type: "ring" }));
  assert.equal(h.value.volume, 0.3);
  await act(() => h.foreground());
  assert.equal(h.value.volume, 0.6);
  await act(() => h.unmount());
  assert.equal(h.removals, 2);
});
test("Expo Go never imports the unavailable native volume module", async () => {
  const h = await harness({ expoGo: true });
  assert.equal(h.value.volume, null);
  await act(() => h.value.setVolume(0.2));
  assert.equal(h.imports, 0);
  assert.equal(h.reads, 0);
  assert.deepEqual(h.writes, []);
  await act(() => h.unmount());
});
test("late startup reads cannot overwrite hardware button changes", async () => {
  const pending = deferred();
  const h = await harness({ read: () => pending.promise });
  await act(() => h.emit({ volume: 0.8, type: "music" }));
  await act(async () => pending.resolve({ volume: 0.1 }));
  assert.equal(h.value.volume, 0.8);
  await act(() => h.unmount());
});
test("quick drags during native readback send the newest value and display quantized media volume", async () => {
  const pending = deferred();
  const h = await harness({
    read: (count) =>
      count === 2 ? pending.promise : Promise.resolve({ volume: count === 1 ? 0.6 : 0.8 }),
  });
  await act(() => h.value.setVolume(0.2));
  await act(() => {
    h.value.setVolume(0.4);
    h.value.setVolume(0.81);
  });
  await act(async () => pending.resolve({ volume: 0.2 }));
  assert.deepEqual(
    h.writes.map(([value]) => value),
    [0.2, 0.81]
  );
  assert.deepEqual(h.writes[1][1], { type: "music", playSound: false, showUI: false });
  assert.equal(h.value.volume, 0.8);
  await act(() => h.unmount());
});
test("failed native writes return to app volume without an unhandled rejection", async () => {
  const h = await harness({
    write: async () => {
      throw new Error("unavailable");
    },
  });
  await act(() => h.value.setVolume(0.2));
  assert.equal(h.value.volume, null);
  await act(() => h.unmount());
});
test("volume gesture keeps its preview through hardware updates then follows the device", async () => {
  const { PlaybackVolumeControl } = load("components/features/music/PlaybackVolumeControl.tsx", {
    "react-native": { Text: "Text", View: "View", Pressable: "Pressable" },
    "@/components/ui/icons": { Icon: "Icon" },
    "heroui-native": {
      Slider: Object.assign((props) => React.createElement("Slider", props), {
        Track: "Track",
        Fill: "Fill",
        Thumb: "Thumb",
      }),
    },
  });
  const values = [];
  const props = {
    volume: 0.5,
    muted: false,
    device: true,
    setVolume: (v) => values.push(v),
    setMuted() {},
  };
  let renderer;
  await act(() => {
    renderer = create(React.createElement(PlaybackVolumeControl, props));
  });
  await act(() => renderer.root.findByType("Slider").props.onChange([81]));
  await act(() =>
    renderer.update(React.createElement(PlaybackVolumeControl, { ...props, volume: 0.6 }))
  );
  assert.deepEqual(renderer.root.findByType("Slider").props.value, [81]);
  await act(() => renderer.root.findByType("Slider").props.onChangeEnd([81]));
  await act(() =>
    renderer.update(React.createElement(PlaybackVolumeControl, { ...props, volume: 0.8 }))
  );
  assert.deepEqual(renderer.root.findByType("Slider").props.value, [80]);
  assert.deepEqual(values, [0.81, 0.81]);
  await act(() => renderer.unmount());
});
