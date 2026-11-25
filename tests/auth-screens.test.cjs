/* global __dirname */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const React = require("react");
const { act, create } = require("react-test-renderer");
const ts = require("typescript");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const src = path.resolve(__dirname, "../src");

function harness() {
  const state = {
    status: "anonymous",
    expired: false,
    pathname: "/login",
    navigation: { key: "root" },
  };
  const navigations = [];
  const keyboardListeners = new Map();
  const timers = new Map();
  const modules = new Map();
  const router = {
    replace: (href) => navigations.push(href),
    push: (href) => navigations.push(href),
  };
  const easing = () => 0;
  const mocks = {
    "react-native": {
      View: "View",
      Text: "Text",
      Pressable: "Pressable",
      ScrollView: "ScrollView",
      KeyboardAvoidingView: "KeyboardAvoidingView",
      Keyboard: {
        metrics: () => state.keyboardMetrics,
        dismiss: () => {
          state.keyboardMetrics = undefined;
        },
        addListener: (name, callback) => {
          keyboardListeners.set(name, callback);
          return { remove: () => keyboardListeners.delete(name) };
        },
      },
      Platform: { OS: "android" },
      Dimensions: { get: () => ({ width: 390, height: 844 }) },
      StyleSheet: {
        create: (styles) => styles,
        absoluteFill: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
      },
    },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "heroui-native": { useThemeColor: (name) => (name === "background" ? "#17111c" : "#10b981") },
    "expo-router": {
      usePathname: () => state.pathname,
      useRootNavigationState: () => state.navigation,
      useRouter: () => router,
      useLocalSearchParams: () => ({}),
    },
    "react-native-reanimated": {
      __esModule: true,
      default: { View: "AnimatedView" },
      Easing: { bezier: () => easing, linear: easing, inOut: () => easing, ease: easing },
      useSharedValue: (value) => React.useRef({ value }).current,
      useAnimatedStyle: (fn) => fn(),
      useReducedMotion: () => false,
      interpolate: (_value, _input, output) => output[0],
      withTiming: (value) => value,
      withRepeat: (value) => value,
      withDelay: (_delay, value) => value,
      cancelAnimation: () => {},
    },
    "react-native-svg": {
      __esModule: true,
      default: "Svg",
      Circle: "Circle",
      Defs: "Defs",
      Path: "Path",
      RadialGradient: "RadialGradient",
      Rect: "Rect",
      Stop: "Stop",
    },
    "lottie-react-native": { __esModule: true, default: "LottieView" },
    "lucide-react-native": Object.fromEntries(
      ["Check", "Eye", "EyeOff", "Lock", "Mail", "Phone", "User"].map((key) => [key, key])
    ),
    "@/components/providers/CustomizationProvider": {
      useCustomization: () => ({ personal: false, welcome: null }),
    },
    "@/components/ui/Animation": { Animation: "Animation" },
    "@/components/providers/AuthProvider": { useAuth: () => state },
    "@/components/ui/ClickButton": { ClickButton: "Button" },
    "@/components/ui/Button": { Button: "Button" },
    "@/components/ui/Modal": { Modal: "Modal" },
    "@/components/ui/Input": { Input: "Input" },
    "@/components/ui/icons": { Icon: "Icon" },
    "@/components/auth/TrendingCarousel": { TrendingCarousel: "TrendingCarousel" },
    "@/lib/api": {
      ApiError: class ApiError extends Error {},
    },
    "@/lib/store": { getItem: () => null, setItem: () => {} },
    "@/lib/cn": { cn: (...values) => values.filter(Boolean).join(" ") },
  };

  function load(filename) {
    filename = path.resolve(src, filename);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const localRequire = (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.endsWith(".json"))
        return JSON.parse(readFileSync(path.resolve(path.dirname(filename), name), "utf8"));
      if (name.startsWith("@/")) return load(`${name.slice(2)}.tsx`);
      if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), `${name}.tsx`));
      return require(name);
    };
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    const setTimer = (callback, delay) => {
      const id = {};
      timers.set(id, { callback, delay });
      return id;
    };
    new Function("module", "exports", "require", "setTimeout", "clearTimeout", code)(
      module,
      module.exports,
      localRequire,
      setTimer,
      (id) => timers.delete(id)
    );
    return module.exports;
  }
  return { load, state, navigations, timers, keyboardListeners };
}

test("sign-in paints a full-height native screen with fields", async () => {
  const { load } = harness();
  const { AuthScreen } = load("components/auth/AuthScreen.tsx");
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(AuthScreen, { mode: "login" }));
  });
  assert.equal(renderer.root.findByType("SafeAreaView").props.style.flex, 1);
  assert.equal(renderer.root.findByType("SafeAreaView").props.style.backgroundColor, "#17111c");
  assert.equal(renderer.root.findAllByType("Input").length, 2);
  assert.match(JSON.stringify(renderer.toJSON()), /Sign in to ZYRAVA/);
  await act(async () => renderer.unmount());
});

test("session loading and redirect keep the root navigator mounted", async () => {
  const { load, state, navigations } = harness();
  const { AuthGate } = load("components/auth/AuthGate.tsx");
  state.pathname = "/";
  state.status = "loading";
  state.navigation = undefined;
  let renderer;
  const element = () => React.createElement(AuthGate, null, React.createElement("Navigator"));
  await act(async () => {
    renderer = create(element());
  });
  assert.equal(renderer.root.findAllByType("Navigator").length, 1);
  state.status = "anonymous";
  state.expired = true;
  await act(async () => renderer.update(element()));
  assert.deepEqual(navigations, []);
  state.navigation = { key: "root" };
  await act(async () => renderer.update(element()));
  assert.deepEqual(navigations, ["/login"]);
  assert.equal(renderer.root.findAllByType("Navigator").length, 1);
  state.pathname = "/login";
  await act(async () => renderer.update(element()));
  assert.equal(renderer.root.findAllByType("SafeAreaView").length, 0);
  await act(async () => renderer.unmount());
});

test("PWA loader switches to the bundled original wake animation after 2.2 seconds", async () => {
  const { load, timers } = harness();
  const { AuthLoadingScreen } = load("components/auth/AuthLoadingScreen.tsx");
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(AuthLoadingScreen));
  });
  assert.match(JSON.stringify(renderer.toJSON()), /Listening studio/);
  assert.equal(renderer.root.findAllByType("LottieView").length, 0);
  const timer = [...timers.values()].find(({ delay }) => delay === 2200);
  assert.ok(timer);
  await act(async () => timer.callback());
  const animation = renderer.root.findByType("LottieView");
  assert.equal(animation.props.autoPlay, true);
  assert.equal(animation.props.loop, true);
  assert.equal(animation.props.source.layers.length, 25);
  assert.equal(animation.props.source.fr, 60);
  assert.match(JSON.stringify(renderer.toJSON()), /Waking up the server/);
  await act(async () => renderer.unmount());
  assert.equal(timers.size, 0);
});

test("font/storage boot uses the branded loader without claiming the server is waking", async () => {
  const { load, timers } = harness();
  const { AuthLoadingScreen } = load("components/auth/AuthLoadingScreen.tsx");
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(AuthLoadingScreen, { allowWake: false }));
  });
  assert.equal(timers.size, 0);
  assert.match(JSON.stringify(renderer.toJSON()), /Listening studio/);
  await act(async () => renderer.unmount());
});

test("slow sign-in shows wake animation; failed sign-in restores the form and error", async () => {
  const { load, state, timers } = harness();
  let rejectLogin;
  let requests = 0;
  state.login = () => {
    requests++;
    return new Promise((_resolve, reject) => {
      rejectLogin = reject;
    });
  };
  const { AuthScreen } = load("components/auth/AuthScreen.tsx");
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(AuthScreen, { mode: "login" }));
  });
  const inputs = renderer.root.findAllByType("Input");
  await act(async () => {
    inputs[0].props.onChange({ target: { value: "member@example.com" } });
    inputs[1].props.onChange({ target: { value: "password" } });
  });
  await act(async () => renderer.root.findByType("Button").props.onPress());
  assert.equal(requests, 1);
  assert.match(JSON.stringify(renderer.toJSON()), /Listening studio/);
  await act(async () => [...timers.values()].find(({ delay }) => delay === 2200).callback());
  assert.equal(renderer.root.findAllByType("LottieView").length, 1);
  await act(async () => renderer.root.findByType("Button").props.onPress());
  assert.equal(requests, 1);
  await act(async () => rejectLogin(new Error("Failure")));
  assert.equal(renderer.root.findAllByType("LottieView").length, 0);
  assert.match(JSON.stringify(renderer.toJSON()), /Something went wrong/);
  assert.equal(renderer.root.findAllByType("Input")[0].props.value, "member@example.com");
  await act(async () => renderer.unmount());
});

test("public sign-in also shows the loader while the initial session request is pending", async () => {
  const { load, state } = harness();
  state.status = "loading";
  const { AuthScreen } = load("components/auth/AuthScreen.tsx");
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(AuthScreen, { mode: "login" }));
  });
  assert.match(JSON.stringify(renderer.toJSON()), /Listening studio/);
  state.status = "anonymous";
  await act(async () => renderer.update(React.createElement(AuthScreen, { mode: "login" })));
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /Listening studio/);
  await act(async () => renderer.unmount());
});

test("a successful sign-in navigates home once", async () => {
  const { load, state, navigations } = harness();
  state.login = async () => {
    state.status = "authenticated";
  };
  const { AuthScreen } = load("components/auth/AuthScreen.tsx");
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(AuthScreen, { mode: "login" }));
  });
  const inputs = renderer.root.findAllByType("Input");
  await act(async () => {
    inputs[0].props.onChange({ target: { value: "member@example.com" } });
    inputs[1].props.onChange({ target: { value: "password" } });
  });
  await act(async () => renderer.root.findByType("Button").props.onPress());
  assert.deepEqual(navigations, ["/"]);
  await act(async () => renderer.unmount());
});

test("the guest sign-in dialog unmounts its portal on account routes", async () => {
  const { load, state, timers } = harness();
  const { GuestLockProvider } = load("components/providers/GuestLockProvider.tsx");
  state.pathname = "/";
  const element = () =>
    React.createElement(GuestLockProvider, null, React.createElement("Navigator"));
  let renderer;
  await act(async () => {
    renderer = create(element());
  });
  await act(async () => [...timers.values()].find(({ delay }) => delay === 900).callback());
  assert.equal(renderer.root.findByType("Modal").props.open, true);
  state.pathname = "/login";
  await act(async () => renderer.update(element()));
  assert.equal(renderer.root.findAllByType("Modal").length, 0);
  assert.equal(renderer.root.findAllByType("Navigator").length, 1);
  await act(async () => renderer.unmount());
});

for (const mode of ["login", "register"]) {
  for (const resized of [false, true]) {
    test(`${mode} keeps inputs above an ${resized ? "already resized" : "overlay"} keyboard`, async () => {
      const { load, keyboardListeners } = harness();
      const { AuthScreen } = load("components/auth/AuthScreen.tsx");
      const scrolls = [];
      let offset = 0;
      let viewportHeight = 700;
      let renderer;
      await act(() => {
        renderer = create(React.createElement(AuthScreen, { mode }), {
          createNodeMock: (element) => {
            if (element.type === "View" && element.props.collapsable === false) {
              return { measureInWindow: (cb) => cb(0, 100, 390, viewportHeight) };
            }
            if (element.type === "Input") {
              return { measureInWindow: (cb) => cb(20, 700 - offset, 350, 48) };
            }
            if (element.type === "ScrollView") {
              return {
                scrollTo: ({ y }) => {
                  scrolls.push(y);
                  offset = y;
                  renderer.root.findByType("ScrollView").props.onScroll({
                    nativeEvent: { contentOffset: { y } },
                  });
                },
              };
            }
            return null;
          },
        });
      });
      const password = renderer.root.findAllByType("Input").at(-1);
      await act(() => password.props.onFocus());
      assert.equal(scrolls.length, 0, "wait for actual keyboard geometry");
      if (resized) viewportHeight = 400;
      await act(() =>
        keyboardListeners.get("keyboardDidShow")({ endCoordinates: { screenY: 500 } })
      );
      await act(() => renderer.root.findByType("ScrollView").props.onContentSizeChange());
      assert.deepEqual(
        scrolls,
        [272],
        "input bottom is 24px above the keyboard; no repeat scrolling"
      );
      assert.equal(
        renderer.root.findByType("ScrollView").props.contentContainerStyle[1].paddingBottom,
        resized ? 32 : 332,
        "reserve only the keyboard overlap"
      );
      // Switching fields while the keyboard is open must reveal the new field too.
      await act(() => password.props.onBlur());
      offset = 0;
      await act(() =>
        renderer.root
          .findByType("ScrollView")
          .props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } })
      );
      await act(() => renderer.root.findAllByType("Input")[0].props.onFocus());
      assert.deepEqual(scrolls, [272, 272]);
      await act(() =>
        keyboardListeners.get("keyboardDidShow")({ endCoordinates: { screenY: 420 } })
      );
      assert.equal(offset, 352, "keyboard height changes preserve clearance");
      await act(() => renderer.root.findAllByType("Input")[0].props.onBlur());
      await act(() =>
        keyboardListeners.get("keyboardDidShow")({ endCoordinates: { screenY: 400 } })
      );
      assert.equal(scrolls.length, 3, "do not restore blurred inputs");
      await act(() => keyboardListeners.get("keyboardDidHide")());
      assert.equal(
        renderer.root.findByType("ScrollView").props.contentContainerStyle[1].paddingBottom,
        32
      );
      await act(() => renderer.unmount());
      assert.equal(keyboardListeners.size, 0);
    });
  }
}

test("registration handles an already-open keyboard and retries a scroll clamped during layout", async () => {
  const { load, state, timers } = harness();
  state.keyboardMetrics = { screenY: 500 };
  const { AuthScreen } = load("components/auth/AuthScreen.tsx");
  let offset = 0;
  let layoutReady = false;
  let renderer;
  const scrolls = [];
  await act(() => {
    renderer = create(React.createElement(AuthScreen, { mode: "register" }), {
      createNodeMock: (element) => {
        if (element.type === "View" && element.props.collapsable === false)
          return { measureInWindow: (cb) => cb(0, 100, 390, 700) };
        if (element.type === "Input")
          return { measureInWindow: (cb) => cb(20, 700 - offset, 350, 48) };
        if (element.type === "ScrollView")
          return {
            scrollTo: ({ y }) => {
              scrolls.push(y);
              offset = layoutReady ? y : 0;
              renderer.root.findByType("ScrollView").props.onScroll({
                nativeEvent: { contentOffset: { y: offset } },
              });
            },
          };
        return null;
      },
    });
  });
  const inputs = renderer.root.findAllByType("Input");
  await act(() => inputs[0].props.onFocus());
  assert.equal(scrolls.at(-1), 272, "focus reads the keyboard without a didShow event");
  assert.equal(offset, 0, "native scroll initially clamped before layout completes");
  await act(() => inputs.at(-1).props.onFocus());
  await act(() => inputs[0].props.onBlur());
  layoutReady = true;
  const retry = [...timers.values()].find(({ delay }) => delay === 350);
  assert.ok(retry, "late blur of the old field must not cancel the new field's retry");
  await act(() => retry.callback());
  assert.equal(offset, 272, "password becomes visible after native layout settles");
  await act(() => renderer.unmount());
  assert.equal(timers.size, 0, "pending work is cancelled on leaving registration");
});
