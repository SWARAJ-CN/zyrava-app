/* global __dirname */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { act, create } = require("react-test-renderer");
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
function clock() {
  const timers = new Map();
  return {
    timers,
    globals: {
      setTimeout: (fn, delay) => {
        const id = Symbol();
        timers.set(id, { fn, delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
    fire: () => {
      for (const { fn } of [...timers.values()]) fn();
    },
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("storage read/write failures leave the in-memory session usable", async () => {
  const store = load("lib/store.ts", {
    "@react-native-async-storage/async-storage": {
      getAllKeys: async () => {
        throw new Error("storage locked");
      },
      setItem: async () => {
        throw new Error("disk full");
      },
      removeItem: () => {
        throw new Error("native storage missing");
      },
    },
  });
  await store.hydrateStorage();
  const changes = [];
  store.onStorageChange((...args) => changes.push(args));
  store.setItem("theme", "dark");
  assert.equal(store.getItem("theme"), "dark");
  store.removeItem("theme");
  await flush();
  assert.equal(store.getItem("theme"), null);
  assert.deepEqual(changes, [
    ["theme", "dark"],
    ["theme", null],
  ]);
});

test("stalled storage cannot block startup or overwrite newer settings when it finally returns", async () => {
  const time = clock();
  let finish;
  const store = load(
    "lib/store.ts",
    {
      "@react-native-async-storage/async-storage": {
        getAllKeys: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        multiGet: async () => [["theme", "old"]],
        setItem: async () => {},
      },
    },
    time.globals
  );
  const first = store.hydrateStorage();
  assert.equal(store.hydrateStorage(), first);
  assert.equal([...time.timers.values()][0].delay, 3000);
  time.fire();
  await first;
  store.setItem("theme", "new");
  finish(["theme"]);
  await flush();
  assert.equal(store.getItem("theme"), "new");
  assert.equal(time.timers.size, 0);
});

test("normal hydration preserves changes and removals made while storage was loading", async () => {
  let finish;
  const store = load("lib/store.ts", {
    "@react-native-async-storage/async-storage": {
      getAllKeys: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      multiGet: async () => [
        ["theme", "old"],
        ["removed", "old"],
        ["kept", "saved"],
      ],
      setItem: async () => {},
      removeItem: async () => {},
    },
  });
  const pending = store.hydrateStorage();
  store.setItem("theme", "new");
  store.removeItem("removed");
  finish(["theme", "removed", "kept"]);
  await pending;
  assert.equal(store.getItem("theme"), "new");
  assert.equal(store.getItem("removed"), null);
  assert.equal(store.getItem("kept"), "saved");
});

test("account deadline covers a stalled connection and a stalled response body", async () => {
  for (const bodyStalled of [false, true]) {
    const time = clock();
    let signal;
    let calls = 0;
    const api = load(
      "lib/api.ts",
      {
        "./net": {
          netFetch: (_url, init) => {
            calls++;
            signal = init.signal;
            return bodyStalled
              ? Promise.resolve({ status: 200, ok: true, json: () => new Promise(() => {}) })
              : new Promise(() => {});
          },
        },
      },
      time.globals
    );
    const pending = api.apiFetch("/api/library");
    await flush();
    assert.equal([...time.timers.values()][0].delay, 30000);
    time.fire();
    await assert.rejects(pending, /took too long/);
    assert.equal(signal.aborted, true);
    assert.equal(calls, 1, "no replay of a possibly completed request");
    assert.equal(time.timers.size, 0);
  }
});

test("captive-portal HTML and incomplete sessions produce API errors rather than invalid auth state", async () => {
  const replies = [
    {
      status: 200,
      ok: true,
      json: async () => {
        throw new Error("HTML");
      },
    },
    { status: 200, ok: true, json: async () => ({ csrfToken: "csrf" }) },
    { status: 200, ok: true, json: async () => ({ user: null }) },
  ];
  const api = load("lib/api.ts", { "./net": { netFetch: async () => replies.shift() } });
  await assert.rejects(
    api.apiFetch("/api/library"),
    (error) => error instanceof api.ApiError && error.status === 502
  );
  await assert.rejects(
    api.loginRequest({ identifier: "test", password: "test", remember: false }),
    /incomplete session/
  );
  assert.equal(api.getAccessToken(), null);
});

test("corrupt cookies do not break requests and account cookies stay on the account origin", async () => {
  let saved = "null";
  const requests = [];
  const net = load(
    "lib/net.ts",
    {
      "./env": { API_URL: "https://account.example" },
      "./store": {
        getItem: () => saved,
        setItem: (_key, value) => {
          saved = value;
        },
      },
    },
    {
      fetch: async (url, init) => {
        requests.push({ url, init });
        return new Response("{}", { headers: { "set-cookie": "session=new; Path=/" } });
      },
    }
  );
  await net.netFetch("/api/auth/csrf");
  assert.equal(requests[0].init.headers.get("Cookie"), null);
  saved = JSON.stringify({
    session: "private",
    invalid: { nested: true },
    newline: "\r\nInjected: true",
  });
  await net.netFetch("/api/library");
  assert.equal(requests[1].init.headers.get("Cookie"), "session=private");
  const before = saved;
  await net.netFetch("https://unrelated.example/data");
  assert.equal(requests[2].init.headers.get("Cookie"), null);
  assert.equal(saved, before);
});

test("audio construction failure reports a playback error without throwing or firing after disposal", async () => {
  const audio = load("lib/go-audio.ts", {
    "expo": { isRunningInExpoGo: () => false },
    "expo-constants": { default: { executionEnvironment: "bare" }, __esModule: true },
    "expo-audio": {
      createAudioPlayer: () => {
        throw new Error("decoder unavailable");
      },
      setAudioModeAsync: async () => {},
    },
  });
  const errors = [];
  const make = () =>
    audio.createGoAudioTransport(
      "https://example.test/song.mp3",
      { onError: (error) => errors.push(error.message) },
      { volume: 1, muted: false, rate: 1 }
    );
  const first = make();
  first.handle.play();
  await flush();
  assert.deepEqual(errors, ["decoder unavailable"]);
  const second = make();
  second.dispose();
  await flush();
  assert.equal(errors.length, 1);
});

test("audio setup cleans up partial players and retries a temporary audio-session failure", async () => {
  let modes = 0;
  let removed = 0;
  const audio = load("lib/go-audio.ts", {
    "expo": { isRunningInExpoGo: () => false },
    "expo-constants": { default: { executionEnvironment: "bare" }, __esModule: true },
    "expo-audio": {
      createAudioPlayer: () => ({
        set volume(_) {
          throw new Error("native setup failed");
        },
        remove() {
          removed++;
        },
      }),
      setAudioModeAsync: async () => {
        if (++modes === 1) throw new Error("interrupted");
      },
    },
  });
  await Promise.all([audio.configureGoAudioMode(), audio.configureGoAudioMode()]);
  assert.equal(modes, 1);
  await audio.configureGoAudioMode();
  assert.equal(modes, 2);
  const errors = [];
  audio.createGoAudioTransport(
    "song.mp3",
    { onError: (error) => errors.push(error.message) },
    { volume: 1, muted: false, rate: 1 }
  );
  await flush();
  assert.equal(removed, 1);
  assert.deepEqual(errors, ["native setup failed"]);
});

test("recovery screen needs no theme/font providers and remains retryable after retry rejects", async () => {
  const { AppErrorScreen } = load("components/AppErrorScreen.tsx", {
    "react-native": {
      View: "View",
      Text: "Text",
      Pressable: "Pressable",
      StyleSheet: { create: (styles) => styles },
    },
    "expo-splash-screen": { hideAsync: async () => {} },
  });
  let retries = 0;
  let renderer;
  await act(() => {
    renderer = create(
      React.createElement(AppErrorScreen, {
        error: new Error("failed screen"),
        retry: async () => {
          retries++;
          throw new Error("still failing");
        },
      })
    );
  });
  await act(() => renderer.root.findByType("Pressable").props.onPress());
  assert.equal(retries, 1);
  assert.equal(renderer.root.findByType("Pressable").props.disabled, false);
  await act(() => renderer.unmount());
});

test("unresolved fonts stop blocking the root screen after the startup deadline", async () => {
  const time = clock();
  const Stack = Object.assign((props) => React.createElement("Stack", props), { Screen: "Screen" });
  const mocks = {
    "react-native-reanimated": {},
    "react-native-gesture-handler": { GestureHandlerRootView: "Root" },
    "react-native-safe-area-context": { SafeAreaProvider: "SafeArea" },
    "expo-status-bar": { StatusBar: "StatusBar" },
    "@expo-google-fonts/inter": { useFonts: () => [false, null] },
    "expo-splash-screen": { preventAutoHideAsync: async () => {}, hideAsync: async () => {} },
    uniwind: { Uniwind: { setTheme() {} } },
    "heroui-native": { HeroUINativeProvider: "HeroUI", useThemeColor: () => "#000" },
    "expo-router": { Stack },
    "react-native": { Appearance: { getColorScheme: () => "dark" } },
    "@/lib/global-font": { INTER_FONTS: {} },
    "../global.css": {},
    "@/lib/store": { hydrateStorage: async () => {}, getItem: () => null },
    "@/lib/i18n/server": { readRequestLocale: () => "en" },
    "@/components/VisitBeacon": { VisitBeacon: "VisitBeacon" },
    "@/components/AppErrorScreen": { AppErrorScreen: "AppErrorScreen" },
    "@/components/auth/AuthGate": { AuthGate: "AuthGate" },
    "@/components/auth/AuthLoadingScreen": { AuthLoadingScreen: "Loading" },
  };
  for (const name of [
    "I18nProvider",
    "PwaProvider",
    "IdleNotifier",
    "ThemeProvider",
    "AuthProvider",
    "CustomizationProvider",
    "GuestLockProvider",
    "ToastProvider",
    "CommunityProvider",
    "TasteProvider",
    "OfflineProvider",
    "MusicPlayerProvider",
    "LibraryProvider",
    "PlaybackSessionGuard",
  ])
    mocks[`@/components/providers/${name}`] = { [name]: name };
  mocks["@/components/providers/ThemeProvider"].useTheme = () => ({ resolved: "dark" });
  const { default: RootLayout } = load("app/_layout.tsx", mocks, time.globals);
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(RootLayout));
  });
  assert.equal(renderer.root.findAllByType("Loading").length, 1);
  assert.equal([...time.timers.values()][0].delay, 8000);
  await act(() => time.fire());
  assert.equal(renderer.root.findAllByType("Loading").length, 0);
  assert.equal(renderer.root.findAllByType("Stack").length, 1);
  await act(() => renderer.unmount());
});
