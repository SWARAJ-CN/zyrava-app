/* global __dirname */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const React = require("react");
const { act, create } = require("react-test-renderer");
const ts = require("typescript");
const { compile } = require("@tailwindcss/node");
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

test("search hides stale suggestions, handles late responses and errors, and submits the current query", async () => {
  const requests = [];
  const commits = [];
  const pause = () => new Promise((resolve) => setTimeout(resolve, 285));
  function List(props) {
    return React.createElement(
      "List",
      { data: props.data },
      props.ListHeaderComponent,
      props.data.length
        ? props.data.map((item, index) =>
            React.createElement(React.Fragment, { key: item.id }, props.renderItem({ item, index }))
          )
        : props.ListEmptyComponent
    );
  }
  const { SearchWithSuggestions } = load("components/features/music/SearchWithSuggestions.tsx", {
    "react-native": {
      View: "View",
      Text: "Text",
      Pressable: "Pressable",
      Modal: "Modal",
      KeyboardAvoidingView: "KeyboardAvoidingView",
      FlatList: List,
      Keyboard: { dismiss() {} },
      Platform: { OS: "android" },
    },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "react-native-gesture-handler": { GestureHandlerRootView: "GestureHandlerRootView" },
    "heroui-native": { useThemeColor: () => "#101419" },
    "expo-image": { Image: "Image" },
    "@/components/ui/Controls": { SearchInput: "SearchInput" },
    "@/components/ui/icons": { Icon: "Icon" },
    "@/components/ui/Feedback": { Skeleton: "Skeleton" },
    "@/hooks/useReduceMotion": { useReduceMotion: () => true },
    "@/lib/cn": { cn: (...args) => args.filter(Boolean).join(" ") },
    "@/lib/saavn": {
      searchSongMatches: (query) =>
        new Promise((resolve, reject) => requests.push({ query, resolve, reject })),
    },
    "@/lib/search-ranking": { isStrongSongMatch: () => true, recordingVersion: () => "" },
  });
  function Harness() {
    const [value, onChange] = React.useState("first song");
    return React.createElement(SearchWithSuggestions, {
      value,
      onChange,
      onPick() {},
      onCommit: (query) => commits.push(query),
    });
  }
  let renderer;
  await act(() => {
    renderer = create(React.createElement(Harness));
  });
  assert.equal(requests.length, 0);
  // Native safe-area views do not receive Uniwind className interop.
  assert.deepEqual(renderer.root.findByType("SafeAreaView").props.style, {
    flex: 1,
    backgroundColor: "#101419",
  });
  assert.equal(renderer.root.findByType("GestureHandlerRootView").props.style.flex, 1);
  assert.equal(renderer.root.findByType("KeyboardAvoidingView").props.style.flex, 1);
  await act(() => renderer.root.findAllByType("Pressable")[0].props.onPress());
  await act(pause);
  assert.equal(requests[0].query, "first song");
  await act(() => renderer.root.findByType("SearchInput").props.onChange("second song"));
  await act(() => requests[0].resolve({ songs: [{ id: "stale" }] }));
  assert.equal(renderer.root.findByType("List").props.data.length, 0);
  await act(pause);
  await act(() =>
    requests[1].resolve({
      songs: [{ id: "correct", title: "Second Song", artist: "Artist", album: "Album" }],
    })
  );
  assert.equal(renderer.root.findByType("List").props.data[0].id, "correct");
  await act(() => renderer.root.findByType("SearchInput").props.onChange("third song"));
  assert.equal(renderer.root.findByType("List").props.data.length, 0);
  await act(pause);
  await act(() => requests[2].reject(new Error("offline")));
  assert.equal(renderer.root.findByType("List").props.data.length, 0);
  assert.ok(
    renderer.root
      .findAllByType("Text")
      .some((node) => node.props.children === "Search couldn’t load")
  );
  await act(() => renderer.root.findByType("SearchInput").props.onSubmit());
  assert.deepEqual(commits, ["third song"]);
  assert.equal(renderer.root.findByType("Modal").props.visible, false);
  await act(() => renderer.unmount());
});

test("home tabs retain state, mount only after a visit, and pause hidden effects", async () => {
  const { HomeTabPanel } = load("components/features/music/HomeTabs.tsx", {
    "@/components/providers/CustomizationProvider": {
      useCustomization: () => ({ personal: false }),
    },
    "react-native": { View: "View" },
    "heroui-native": {},
    "@/hooks/useReduceMotion": {},
  });
  const mounts = { songs: 0, playlists: 0 };
  const running = new Set();
  function Probe({ name }) {
    const [selection, setSelection] = React.useState(() => {
      mounts[name]++;
      return "initial";
    });
    React.useEffect(() => {
      running.add(name);
      return () => running.delete(name);
    }, [name]);
    return React.createElement("Probe", { name, selection, setSelection });
  }
  const panels = (active) =>
    React.createElement(
      React.Fragment,
      null,
      ...["songs", "playlists"].map((name) =>
        React.createElement(
          HomeTabPanel,
          { key: name, active: active === name },
          React.createElement(Probe, { name })
        )
      )
    );
  let renderer;
  await act(() => {
    renderer = create(panels("songs"));
  });
  assert.deepEqual(mounts, { songs: 1, playlists: 0 });
  await act(() => renderer.root.findByType("Probe").props.setSelection("page 4"));
  await act(() => renderer.update(panels("playlists")));
  assert.deepEqual([...running], ["playlists"]);
  await act(() => renderer.update(panels("songs")));
  assert.deepEqual(mounts, { songs: 1, playlists: 1 });
  assert.deepEqual([...running], ["songs"]);
  assert.equal(
    renderer.root.findAllByType("Probe").find((node) => node.props.name === "songs").props
      .selection,
    "page 4"
  );
  await act(() => renderer.unmount());
  assert.equal(running.size, 0);
});

test("playlist tabs reuse pending and completed requests and retain a draft on return", async () => {
  const requests = [];
  const noop = () => {};
  const { PlaylistsView } = load("components/features/music/PlaylistsView.tsx", {
    "react-native": Object.fromEntries(
      ["Image", "Pressable", "ScrollView", "Text", "TextInput", "View"].map((name) => [name, name])
    ),
    "@/components/ui/icons": { Icon: "Icon" },
    "@/components/ui/ClickButton": { ClickButton: "Button" },
    "@/components/features/music/SongRows": {},
    "@/components/features/music/CollectionHero": {},
    "@/lib/format": {},
    "@/components/providers/LibraryProvider": {
      useLibrary: () => ({ playlists: [], createPlaylist: noop }),
    },
    "@/components/providers/MusicPlayerProvider": { useMusicPlayer: () => ({ startQueue: noop }) },
    "@/components/providers/ToastProvider": { useToast: () => ({ toast: noop }) },
    "@/lib/cn": { cn: (...args) => args.filter(Boolean).join(" ") },
    "@/lib/saavn": {
      searchPlaylists: (query) => new Promise((resolve) => requests.push({ query, resolve })),
    },
    "@/components/ui/Scrim": { Scrim: "Scrim", SCRIM_STOPS: {} },
  });
  const panel = (mode, query = "pop") =>
    React.createElement(React.Activity, { mode }, React.createElement(PlaylistsView, { query }));
  let renderer;
  await act(() => {
    renderer = create(panel("visible"));
  });
  assert.equal(requests.length, 1);
  await act(() => renderer.update(panel("hidden")));
  await act(() => renderer.update(panel("visible")));
  assert.equal(requests.length, 1, "switching during loading must reuse the request");
  await act(() => requests[0].resolve({ playlists: [] }));
  await act(() => renderer.root.findByType("Button").props.onClick());
  await act(() => renderer.root.findByType("TextInput").props.onChangeText("Road trip"));
  await act(() => renderer.update(panel("hidden")));
  await act(() => renderer.update(panel("visible")));
  assert.equal(requests.length, 1, "returning to a loaded tab must not refetch");
  assert.equal(renderer.root.findByType("TextInput").props.value, "Road trip");
  await act(() => renderer.update(panel("visible", "jazz")));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].query, "jazz");
  await act(() => requests[1].resolve({ playlists: [] }));
  await act(() => renderer.unmount());
});

test("compiled Inter weights and HeroUI labels use registered faces without runtime font patching", async () => {
  const base = path.resolve(__dirname, "../src");
  const compiler = await compile(readFileSync(path.join(base, "global.css"), "utf8"), {
    base,
    onDependency() {},
  });
  const weights = {
    normal: "Inter_400Regular",
    medium: "Inter_500Medium",
    semibold: "Inter_600SemiBold",
    bold: "Inter_700Bold",
    black: "Inter_900Black",
  };
  const css = compiler.build(Object.keys(weights).map((weight) => `font-${weight}`));
  for (const [weight, family] of Object.entries(weights)) {
    assert.match(css, new RegExp(`\\.font-${weight} \\{\\s+font-family: "${family}";`));
  }
  assert.match(css, /\.button__label \{\s+font-family: "Inter_500Medium";/);
  const createElement = React.createElement;
  const jsx = require("react/jsx-runtime").jsx;
  const assets = Object.fromEntries(Object.values(weights).map((family, index) => [family, index]));
  const fonts = load("lib/global-font.ts", { "@expo-google-fonts/inter": assets });
  assert.equal(fonts.INTER_FONTS.Inter_700Bold, assets.Inter_700Bold);
  assert.equal(React.createElement, createElement);
  assert.equal(require("react/jsx-runtime").jsx, jsx);
});

test("buttons share one native motion subscription and a pending query cannot undo a live preference", async () => {
  let queries = 0;
  let subscriptions = 0;
  let removals = 0;
  let resolveInitial;
  let preferenceChanged;
  const { useReduceMotion } = load("hooks/useReduceMotion.ts", {
    "react-native": {
      AccessibilityInfo: {
        isReduceMotionEnabled() {
          queries++;
          return new Promise((resolve) => {
            resolveInitial = resolve;
          });
        },
        addEventListener(_name, handler) {
          subscriptions++;
          preferenceChanged = handler;
          return {
            remove() {
              removals++;
            },
          };
        },
      },
    },
  });
  function Consumer() {
    return React.createElement("Motion", { reduced: useReduceMotion() });
  }
  let renderer;
  await act(() => {
    renderer = create(
      React.createElement(
        React.Fragment,
        null,
        ...Array.from({ length: 8 }, (_, key) => React.createElement(Consumer, { key }))
      )
    );
  });
  assert.equal(queries, 1);
  assert.equal(subscriptions, 1);
  await act(() => preferenceChanged(true));
  await act(async () => resolveInitial(false));
  assert.ok(renderer.root.findAllByType("Motion").every((node) => node.props.reduced));
  await act(() => renderer.unmount());
  assert.equal(removals, 1);
});

test("button accepts conditional children without crashing or losing its icon and text", async () => {
  const HeroButton = Object.assign(
    React.forwardRef(function HeroButton(props, ref) {
      return React.createElement("Button", { ...props, ref });
    }),
    { Label: "Label" }
  );
  const Icon = () => null;
  const { Button } = load("components/ui/Button.tsx", {
    "react-native": { Text: "Text" },
    "expo-router": { Link: "Link" },
    "react-native-reanimated": { __esModule: true, default: { View: "AnimatedView" } },
    "lucide-react-native": { Loader2: "Loader" },
    "heroui-native": {
      Button: HeroButton,
      useThemeColor: () => "#fff",
      buttonClassNames: { root: () => "button" },
    },
    "@/lib/cn": { cn: (...values) => values.filter(Boolean).join(" ") },
    "./icons": { Icon },
  });
  let renderer;
  await act(() => {
    renderer = create(
      React.createElement(Button, null, null, false, undefined, React.createElement(Icon), "Next")
    );
  });
  assert.equal(renderer.root.findByType(Icon).props.color, "#fff");
  assert.equal(renderer.root.findByType("Text").props.children, "Next");
  await act(() => renderer.unmount());
});

test("fitted view selector gives every option a share and keeps its last option selectable", async () => {
  const { SegmentedControl } = load("components/ui/Controls.tsx", {
    "react-native": {
      View: "View",
      Text: "Text",
      ScrollView: "ScrollView",
      Pressable: "Pressable",
    },
    "react-native-reanimated": {
      __esModule: true,
      default: { View: "AnimatedView" },
      useSharedValue: (value) => React.useRef({ value }).current,
      useAnimatedStyle: (fn) => fn(),
      withTiming: (value) => value,
    },
    "heroui-native": {},
    "@/lib/cn": { cn: (...args) => args.filter(Boolean).join(" ") },
    "@/components/providers/I18nProvider": {},
    "@/lib/voice-ops": {},
    "@/lib/voice": {},
    "./icons": {},
    "./ClickButton": { useReduceMotion: () => true },
  });
  let selected;
  const options = ["list", "small", "large"].map((value) => ({
    value,
    label: value,
    icon: React.createElement("Icon"),
  }));
  let renderer;
  await act(() => {
    renderer = create(
      React.createElement(SegmentedControl, {
        options,
        value: "list",
        fit: true,
        onChange: (value) => {
          selected = value;
        },
      })
    );
  });
  assert.equal(renderer.root.findAllByType("ScrollView").length, 0);
  const tabs = renderer.root.findAllByType("Pressable");
  assert.equal(tabs.length, 3);
  assert.ok(tabs.every((tab) => tab.props.className.includes("min-w-0 flex-1")));
  await act(() => tabs[2].props.onPress());
  assert.equal(selected, "large");
  await act(() => renderer.unmount());
});

test("older native APKs can open Now Playing without loading an absent blur module", async () => {
  let blurLoads = 0;
  const mocks = {
    "react-native": {
      View: "View",
      StyleSheet: { absoluteFill: { position: "absolute", inset: 0 } },
    },
    "expo-modules-core": { requireOptionalNativeModule: () => null },
    "heroui-native": { useThemeColor: () => "#101419" },
    "@/components/providers/ThemeProvider": { useTheme: () => ({ resolved: "dark" }) },
    "./BeatGlow": { BeatGlow: "BeatGlow" },
  };
  Object.defineProperty(mocks, "expo-blur", {
    get() {
      blurLoads++;
      throw new Error("Native blur unavailable");
    },
  });
  const { NowPlayingBackdrop } = load("components/features/music/NowPlayingBackdrop.tsx", mocks);
  let renderer;
  await act(() => {
    renderer = create(
      React.createElement(NowPlayingBackdrop, {
        getAnalyser: () => null,
        playing: true,
        hueSeed: 100,
      })
    );
  });
  assert.equal(blurLoads, 0);
  assert.equal(renderer.root.findByType("BeatGlow").props.playing, true);
  assert.equal(renderer.root.findAllByType("View")[0].props.pointerEvents, "none");
  await act(() => renderer.unmount());
});

test("reader transport stays outside scrolling content and wires previous, pause, next and seek", async () => {
  const actions = [];
  const player = {
    current: { id: "song", title: "Song", artist: "Artist", album: "Album" },
    queue: [{ id: "song" }],
    index: 0,
    playing: true,
    loading: false,
    nowPlayingOpen: true,
    setNowPlayingOpen: () => actions.push("close"),
    getAnalyser: () => null,
    togglePlay: () => actions.push("pause"),
    stepTrack: (n) => actions.push(n),
    seek: (n) => actions.push(n),
  };
  const playerModule = {
    useMusicPlayer: () => player,
    usePlaybackProgress: () => ({ progress: 12, duration: 180 }),
  };
  const native = {
    View: "View",
    Text: "Text",
    Pressable: "Pressable",
    Image: "Image",
    ActivityIndicator: "Spinner",
    StyleSheet: { absoluteFill: { position: "absolute", inset: 0 } },
    useWindowDimensions: () => ({ width: 360, height: 480 }),
  };
  const { NowPlayingTransport } = load("components/features/music/NowPlayingTransport.tsx", {
    "react-native": native,
    "heroui-native": { useThemeColor: () => "#fff" },
    "@/components/ui/icons": { Icon: "Icon" },
    "@/components/providers/MusicPlayerProvider": playerModule,
    "./PlaybackSeekBar": { PlaybackSeekBar: "SeekBar" },
  });
  const { NowPlayingPanel } = load("components/features/music/NowPlayingPanel.tsx", {
    "./FullscreenLyrics": { FullscreenLyrics: "FullscreenLyrics" },
    "react-native": native,
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 20, bottom: 24 }) },
    "@/hooks/usePanelBackHandler": { usePanelBackHandler() {} },
    "@/components/ui/icons": { Icon: "Icon" },
    "@/components/providers/MusicPlayerProvider": playerModule,
    "./NowPlayingTabs": {
      useNowPlayingTab: () => ["lyrics", () => {}],
      NowPlayingTabs: () => React.createElement("ScrollView", null, "Lyrics"),
    },
    "./BeatGlow": { songHueSeed: () => 100 },
    "./NowPlayingBackdrop": { NowPlayingBackdrop: "Backdrop" },
    "./NowPlayingTransport": { NowPlayingTransport },
  });
  let renderer;
  await act(() => {
    renderer = create(React.createElement(NowPlayingPanel));
  });
  const controls = renderer.root.findByProps({ accessibilityLabel: "Playback controls" });
  assert.equal(controls.props.style.flexShrink, 0);
  assert.equal(controls.props.style.paddingBottom, 24);
  for (let parent = controls.parent; parent; parent = parent.parent)
    assert.notEqual(parent.type, "ScrollView");
  await act(() =>
    renderer.root.findByProps({ accessibilityLabel: "Previous track" }).props.onPress()
  );
  await act(() => renderer.root.findByProps({ accessibilityLabel: "Pause" }).props.onPress());
  await act(() => renderer.root.findByProps({ accessibilityLabel: "Next track" }).props.onPress());
  await act(() => renderer.root.findByType("SeekBar").props.seek(50));
  assert.deepEqual(actions, [-1, "pause", 1, 50]);
  player.loading = true;
  await act(() => renderer.update(React.createElement(NowPlayingPanel)));
  assert.equal(renderer.root.findByType("Spinner").props.accessibilityLabel, "Loading audio");
  await act(() => renderer.unmount());
});

test("ambient colour sampling stops when paused, backgrounded or motion is reduced", async () => {
  let reduced = false;
  let changeState;
  const frames = new Map();
  let nextFrame = 0;
  let reads = 0;
  const { BeatGlow } = load(
    "components/features/music/BeatGlow.tsx",
    {
      "react-native": {
        StyleSheet: { absoluteFill: {} },
        AppState: {
          currentState: "active",
          addEventListener: (_name, fn) => {
            changeState = fn;
            return { remove() {} };
          },
        },
      },
      "react-native-svg": {
        __esModule: true,
        default: "Svg",
        Defs: "Defs",
        LinearGradient: "LinearGradient",
        Rect: "Rect",
        Stop: "Stop",
      },
      "react-native-reanimated": {
        __esModule: true,
        default: { View: "AnimatedView" },
        useSharedValue: (value) => React.useRef({ value }).current,
        useAnimatedStyle: (fn) => fn(),
      },
      "@/hooks/useReduceMotion": { useReduceMotion: () => reduced },
    },
    {
      requestAnimationFrame: (fn) => {
        frames.set(++nextFrame, fn);
        return nextFrame;
      },
      cancelAnimationFrame: (id) => frames.delete(id),
    }
  );
  const getAnalyser = () => ({
    getByteFrequencyData: (bins) => {
      bins.fill(128);
      reads++;
    },
  });
  const render = (playing) => React.createElement(BeatGlow, { getAnalyser, playing, hueSeed: 120 });
  let renderer;
  await act(() => {
    renderer = create(render(true));
  });
  assert.equal(frames.size, 1);
  const [id, frame] = [...frames][0];
  frames.delete(id);
  await act(() => frame(100));
  assert.equal(reads, 1);
  await act(() => changeState("background"));
  assert.equal(frames.size, 0);
  await act(() => changeState("active"));
  assert.equal(frames.size, 1);
  await act(() => renderer.update(render(false)));
  assert.equal(frames.size, 0);
  reduced = true;
  await act(() => renderer.update(render(true)));
  assert.equal(frames.size, 0);
  await act(() => renderer.unmount());
});

test("lyrics-card EQ edits shared controls on release and disables unavailable processing", async () => {
  const writes = [];
  let supported = true;
  let preview = false;
  const presets = [
    { label: "Flat", gains: Array(10).fill(0) },
    { label: "Bass", gains: [4, ...Array(9).fill(0)] },
    { label: "Heavy", gains: Array(10).fill(10), heavy: true },
  ];
  const player = {
    eqPreset: "Flat",
    eqGains: Array(10).fill(0),
    spatialMode: "off",
    getGraphInfo: () => ({
      webAudio: supported,
      equalizer: supported || preview,
      spatial: supported || preview,
    }),
    applyPreset: (preset) => {
      writes.push(preset.label);
      player.eqPreset = preset.label;
      player.eqGains = preset.gains;
    },
    setEqGains: (gains) => {
      writes.push(gains);
      player.eqGains = gains;
    },
    markEqCustom: (gains) => {
      writes.push(["Custom", gains]);
      player.eqPreset = "Custom";
    },
    setSpatialMode: (mode) => writes.push(mode),
  };
  const Slider = Object.assign((props) => React.createElement("Slider", props), {
    Track: "Track",
    Fill: "Fill",
    Thumb: "Thumb",
  });
  const { NowPlayingEqualizer } = load("components/features/music/NowPlayingEqualizer.tsx", {
    "react-native": {
      View: "View",
      Text: "Text",
      Pressable: "Pressable",
      ScrollView: "ScrollView",
    },
    "heroui-native": { Slider },
    "@/components/providers/MusicPlayerProvider": {
      useMusicPlayer: () => player,
      EQ_PRESETS: presets,
      EQ_BANDS: Array.from({ length: 10 }, (_, i) => ({ frequency: i + 1, label: String(i + 1) })),
      SPATIAL_MODES: [
        { value: "off", label: "Off" },
        { value: "wide", label: "Wide" },
      ],
    },
    "@/components/ui/ConfirmDialog": { ConfirmDialog: "Confirm" },
    "@/lib/cn": { cn: (...args) => args.filter(Boolean).join(" ") },
  });
  let renderer;
  await act(() => {
    renderer = create(React.createElement(NowPlayingEqualizer));
  });
  assert.equal(renderer.root.findAllByType("Slider").length, 10);
  await act(() => renderer.root.findAllByType("Slider")[2].props.onChange([3.4]));
  assert.equal(writes.length, 0, "dragging stays local instead of rerendering the player");
  await act(() => renderer.root.findAllByType("Slider")[2].props.onChangeEnd([3.4]));
  assert.equal(writes[0][2], 3.5);
  assert.deepEqual(writes[1], ["Custom", writes[0]]);
  await act(() =>
    renderer.root.findByProps({ accessibilityLabel: "Bass equalizer preset" }).props.onPress()
  );
  await act(() => renderer.root.findByProps({ accessibilityLabel: "Wide" }).props.onPress());
  assert.deepEqual(writes.slice(-2), ["Bass", "wide"]);
  await act(() =>
    renderer.root.findByProps({ accessibilityLabel: "Heavy equalizer preset" }).props.onPress()
  );
  assert.equal(writes.at(-1), "wide", "heavy presets retain the existing confirmation behavior");
  await act(() => renderer.root.findByType("Confirm").props.onCancel());
  await act(() =>
    renderer.root.findByProps({ accessibilityLabel: "Reset equalizer to flat" }).props.onPress()
  );
  assert.equal(writes.at(-1), "Flat");
  supported = false;
  await act(() => renderer.update(React.createElement(NowPlayingEqualizer)));
  assert.ok(renderer.root.findAllByType("Slider").every((node) => node.props.isDisabled));
  const before = writes.length;
  await act(() => renderer.root.findAllByType("Slider")[0].props.onChangeEnd([6]));
  await act(() =>
    renderer.root.findByProps({ accessibilityLabel: "Bass equalizer preset" }).props.onPress()
  );
  assert.equal(writes.length, before);
  preview = true;
  await act(() => renderer.update(React.createElement(NowPlayingEqualizer)));
  assert.ok(renderer.root.findAllByType("Slider").every((node) => !node.props.isDisabled));
  assert.equal(renderer.root.findByProps({ accessibilityLabel: "Wide" }).props.disabled, false);
  await act(() => renderer.root.findByProps({ accessibilityLabel: "Wide" }).props.onPress());
  assert.equal(writes.at(-1), "wide");
  await act(() =>
    renderer.root.findByProps({ accessibilityLabel: "Bass equalizer preset" }).props.onPress()
  );
  assert.equal(writes.at(-1), "Bass");
  await act(() => renderer.unmount());
});

test("now-playing restores the EQ tab and remembers changing back to lyrics", async () => {
  let saved = "eq";
  const Tabs = Object.assign((props) => React.createElement("Tabs", props), {
    List: "List",
    Indicator: "Indicator",
    Label: "Label",
    Trigger: ({ children, ...props }) =>
      React.createElement("Trigger", props, children({ isSelected: props.value === saved })),
  });
  const { NowPlayingTabs, useNowPlayingTab } = load(
    "components/features/music/NowPlayingTabs.tsx",
    {
      "@/components/providers/CustomizationProvider": {
        useCustomization: () => ({ personal: false }),
      },
      "heroui-native": { Tabs },
      "@/hooks/useReduceMotion": { useReduceMotion: () => true },
      "@/components/features/music/LyricsPanel": { LyricsPanel: "Lyrics" },
      "@/components/features/music/RelatedSongs": { RelatedSongs: "Related" },
      "./NowPlayingEqualizer": { NowPlayingEqualizer: "Equalizer" },
      "@/lib/store": {
        getItem: () => saved,
        setItem: (_key, value) => {
          saved = value;
        },
      },
    }
  );
  function Panel() {
    const [tab, onTab] = useNowPlayingTab();
    return React.createElement(NowPlayingTabs, { song: { id: "song" }, tab, onTab });
  }
  let renderer;
  await act(() => {
    renderer = create(React.createElement(Panel));
  });
  assert.equal(renderer.root.findAllByType("Equalizer").length, 1);
  assert.equal(renderer.root.findAllByType("Trigger").length, 3);
  await act(() => renderer.root.findByType("Tabs").props.onValueChange("lyrics"));
  assert.equal(saved, "lyrics");
  assert.equal(renderer.root.findAllByType("Lyrics").length, 1);
  await act(() => renderer.unmount());
});
