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

for (const [name, Audio] of [
  [
    "memo(forwardRef)",
    React.memo(
      React.forwardRef(function TestAudio() {
        return null;
      })
    ),
  ],
  [
    "forwardRef",
    React.forwardRef(function TestAudio() {
      return null;
    }),
  ],
  ["function", () => null],
]) {
  test(`native audio engine accepts a ${name} Audio component`, () => {
    const candidate = { AudioContext: class {}, Audio };
    const engine = load("lib/audio-engine.ts", {
      "expo-constants": { default: { executionEnvironment: "bare" }, __esModule: true },
      "react-native-audio-api": candidate,
    });
    assert.equal(engine.getAudioEngine(), candidate);
    assert.equal(engine.audioBackend(), "native-graph");
    assert.equal(engine.hasAdvancedAudio, true);
  });
}

test("seek bar accepts one tap, holds its preview through stale ticks, and drags once on release", async () => {
  const { PlaybackSeekBar, formatPlaybackTime } = load(
    "components/features/music/PlaybackSeekBar.tsx",
    {
      "react-native": { Text: "Text", View: "View" },
      "heroui-native": { useThemeColor: () => "#34d399" },
    }
  );
  const seeks = [];
  const props = { progress: 10, duration: 180, seek: (time) => seeks.push(time) };
  let renderer;
  await act(() => {
    renderer = create(React.createElement(PlaybackSeekBar, props));
  });
  const bar = () => renderer.root.findByProps({ accessibilityLabel: "Seek" });
  const touch = (x) => ({ nativeEvent: { locationX: x, pageX: x + 40 } });
  await act(() => bar().props.onLayout({ nativeEvent: { layout: { width: 180 } } }));
  assert.equal(bar().props.onStartShouldSetResponder(), true);
  assert.equal(bar().props.style.height, 44);
  await act(() => bar().props.onResponderGrant(touch(75)));
  assert.equal(bar().props.accessibilityValue.now, 75);
  await act(() => bar().props.onResponderRelease(touch(75)));
  assert.deepEqual(seeks, [75], "one tap commits one seek");
  await act(() =>
    renderer.update(React.createElement(PlaybackSeekBar, { ...props, progress: 11 }))
  );
  assert.equal(bar().props.accessibilityValue.now, 75, "old decoder tick cannot undo tap feedback");
  await act(() =>
    renderer.update(React.createElement(PlaybackSeekBar, { ...props, progress: 75 }))
  );
  await act(() =>
    renderer.update(React.createElement(PlaybackSeekBar, { ...props, progress: 77 }))
  );
  assert.equal(bar().props.accessibilityValue.now, 77, "clock resumes after acknowledgement");
  await act(() => bar().props.onResponderGrant(touch(50)));
  await act(() => bar().props.onResponderMove(touch(100)));
  await act(() =>
    renderer.update(React.createElement(PlaybackSeekBar, { ...props, progress: 78 }))
  );
  assert.equal(bar().props.accessibilityValue.now, 100);
  assert.deepEqual(seeks, [75], "drag does not repeatedly seek the decoder");
  await act(() => bar().props.onResponderRelease(touch(190)));
  assert.deepEqual(seeks, [75, 180], "release is clamped to duration");
  await act(() => bar().props.onResponderGrant(touch(50)));
  await act(() => bar().props.onResponderTerminate());
  assert.equal(bar().props.accessibilityValue.now, 78);
  assert.deepEqual(seeks, [75, 180], "interrupted gesture does not seek");
  await act(() => bar().props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }));
  assert.deepEqual(seeks, [75, 180, 88]);
  await act(() => renderer.update(React.createElement(PlaybackSeekBar, { ...props, duration: 0 })));
  assert.equal(bar().props.onStartShouldSetResponder(), false);
  await act(() => bar().props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }));
  assert.deepEqual(seeks, [75, 180, 88]);
  assert.equal(formatPlaybackTime(59.9), "0:59");
  assert.equal(formatPlaybackTime(60), "1:00");
  await act(() => renderer.unmount());
});

function audioHarness(options = {}) {
  const storage = options.storage ?? new Map();
  let appStateListener, interruptionListener;
  let timerId = 0;
  const timeouts = new Map(),
    intervals = new Map();
  const instances = [];
  const events = [];
  const lyricPrefetches = [];
  const nodes = [];
  const sources = [];
  let audioProps;
  let now = 10000;
  class Context {
    state = "running";
    currentTime = 0;
    sampleRate = 48000;
    destination = {};
    resume = async () => {};
    close = async () => {};
    node(kind) {
      const param = () => ({
        value: 0,
        setTargetAtTime(value) {
          this.value = value;
        },
      });
      const node = {
        kind,
        context: this,
        connections: [],
        gain: param(),
        pan: param(),
        frequency: param(),
        Q: param(),
        delayTime: param(),
        positionX: param(),
        positionY: param(),
        positionZ: param(),
        start() {
          this.started = true;
        },
        stop() {
          this.stopped = true;
        },
        connect(target) {
          this.connections.push(target);
        },
        disconnect(target) {
          this.connections = target ? this.connections.filter((item) => item !== target) : [];
        },
      };
      nodes.push(node);
      return node;
    }
    createGain() {
      return this.node("gain");
    }
    createBiquadFilter() {
      return this.node("filter");
    }
    createStereoPanner() {
      return this.node("pan");
    }
    createAnalyser() {
      return this.node("analyser");
    }
    createChannelSplitter() {
      return this.node("splitter");
    }
    createChannelMerger() {
      return this.node("merger");
    }
    createOscillator() {
      return this.node("oscillator");
    }
    createPanner() {
      return this.node("panner3d");
    }
    createDelay() {
      if (options.failDelay) throw new Error("delay unavailable");
      return this.node("delay");
    }
    createMediaElementSource(handle) {
      const source = this.node("source");
      source.handle = handle;
      sources.push(source);
      return source;
    }
  }
  const Audio = React.forwardRef(function AudioStub(props, ref) {
    const [instance] = React.useState(() => {
      const entry = { source: props.source, playing: false, props, handle: null };
      entry.handle = {
        setVolume() {},
        setMuted() {},
        setPlaybackRate() {},
        seekToTime(time) {
          entry.position = time;
          events.push(["seek", time]);
        },
        play() {
          entry.playing = true;
          events.push(["play", entry.source]);
          entry.props.onPlay();
        },
        pause() {
          entry.playing = false;
          events.push(["pause", entry.source]);
          entry.props.onPause();
        },
      };
      instances.push(entry);
      return entry;
    });
    instance.props = props;
    audioProps = props;
    React.useImperativeHandle(ref, () => instance.handle, [instance]);
    React.useEffect(() => {
      if (!options.manualLoad) props.onLoad();
    }, [props.source]); // eslint-disable-line react-hooks/exhaustive-deps
    React.useEffect(
      () => () => {
        instance.playing = false;
      },
      [instance]
    );
    return null;
  });
  const engine = {
    PlaybackNotificationManager: options.notifications,
    Audio,
    AudioContext: Context,
    AudioManager: {
      setAudioSessionActivity: async () => {},
      observeAudioInterruptions() {},
      requestNotificationPermissions: async () => {},
    },
  };
  const record = () => {};
  const openPlaybackUrl = options.openPlaybackUrl ?? (async () => null);
  const graph = load("lib/playback-graph.ts");
  const player = load(
    "components/providers/MusicPlayerProvider.tsx",
    {
      "react-native": {
        AppState: {
          currentState: "active",
          addEventListener: (_name, listener) => {
            appStateListener = listener;
            return { remove() {} };
          },
        },
      },
      "@/hooks/useDeviceVolume": {
        useDeviceVolume: () => ({
          volume: options.deviceVolume ?? null,
          setVolume: options.setDeviceVolume ?? record,
        }),
      },
      "@/lib/audio-engine": { getAudioEngine: () => (options.go ? null : engine) },
      "@/lib/go-equalizer": load("lib/go-equalizer.ts", {
        "./go-spatial": load("lib/go-spatial.ts"),
        "./karaoke": load("lib/karaoke.ts"),
      }),
      "./GoEqualizerHost": {
        GoEqualizerHost: (props) => {
          const { onAvailable } = props;
          React.useEffect(() => {
            if (!options.goEffects) onAvailable(false);
          }, [onAvailable]);
          return React.createElement("GoEqualizerHost", props);
        },
      },
      "./GoKaraokePreparation": options.noKaraoke
        ? null
        : { GoKaraokePreparation: "GoKaraokePreparation" },
      "@/lib/playback-graph": graph,
      "@/lib/karaoke": load("lib/karaoke.ts"),
      "@/lib/instrumentals": {
        getInstrumental: (id) => options.instrumentals?.get(id) ?? null,
        pickInstrumental:
          options.pickInstrumental ?? (async (id) => options.instrumentals?.get(id) ?? null),
      },
      "@/lib/lyrics-cache": {
        loadLyrics: async (song) => {
          lyricPrefetches.push(song.id);
          return { kind: "none" };
        },
      },
      "@/lib/go-audio": {
        configureGoAudioMode: async () => {},
        createGoAudioTransport: (source, callbacks) => {
          const entry = { source, playing: false, props: callbacks, position: 0 };
          entry.handle = {
            setVolume() {},
            setMuted() {},
            setPlaybackRate() {},
            play() {
              entry.playing = true;
              events.push(["play", source]);
              callbacks.onPlay();
            },
            pause() {
              entry.playing = false;
              events.push(["pause", source]);
              callbacks.onPause();
            },
            async seekToTime(time) {
              entry.position = time;
              events.push(["seek", time]);
              callbacks.onPositionChange(time);
            },
          };
          instances.push(entry);
          return {
            handle: entry.handle,
            dispose() {
              entry.playing = false;
              events.push(["dispose", source]);
              callbacks.onPause();
            },
          };
        },
      },
      "@/lib/saavn": { searchSongs: async () => ({ songs: [] }) },
      "@/lib/taste": { playbackKind: () => "skip", buildRadioFor: async () => [] },
      "@/components/providers/TasteProvider": { useTaste: () => ({ record, vector: null }) },
      "@/components/providers/OfflineProvider": { useOffline: () => ({ openPlaybackUrl }) },
      "@/components/providers/GuestLockProvider": {
        useGuestLock: () => ({ isGuest: false, requestLogin: record }),
      },
      "@/lib/dj/pads": {},
      "@/lib/wake-info": {
        onAudioInterruption: (listener) => {
          interruptionListener = listener;
          return () => {};
        },
        deactivateAudioSession: async () => {},
      },
      "@/lib/player-memory": load("lib/player-memory.ts"),
      "@/lib/store": {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key),
      },
    },
    {
      setInterval: (callback, delay) => {
        const id = ++timerId;
        intervals.set(id, { callback, delay });
        return id;
      },
      clearInterval(id) {
        intervals.delete(id);
      },
      setTimeout: (callback) => {
        const id = ++timerId;
        timeouts.set(id, callback);
        return id;
      },
      clearTimeout(id) {
        timeouts.delete(id);
      },
      Date: class extends Date {
        static now() {
          return now;
        }
      },
    }
  );
  return {
    player,
    instances,
    lyricPrefetches,
    events,
    sources,
    nodes,
    appState(state) {
      appStateListener(state);
    },
    interrupt(event) {
      interruptionListener(event);
    },
    watchdog() {
      now += 6000;
      for (const timer of intervals.values()) if (timer.delay === 6000) timer.callback();
    },
    flushTimeouts() {
      const pending = [...timeouts.values()];
      timeouts.clear();
      pending.forEach((callback) => callback());
    },
    tick(time) {
      now += 300;
      audioProps.onPositionChange(time);
    },
  };
}

test("new native sources keep the same EQ, and clock ticks do not rerender controls", async () => {
  const { player, sources, nodes, tick } = audioHarness();
  let controls;
  let progress;
  let drawerOpen;
  let renders = 0;
  function Catalogue() {
    controls = player.useMusicPlayer();
    renders++;
    return null;
  }
  function Clock() {
    progress = player.usePlaybackProgress().progress;
    return null;
  }
  function Drawer() {
    drawerOpen = player.useMobileNavOpen();
    return null;
  }
  let renderer;
  await act(() => {
    renderer = create(
      React.createElement(
        player.MusicPlayerProvider,
        null,
        React.createElement(Catalogue),
        React.createElement(Clock),
        React.createElement(Drawer)
      )
    );
  });
  const songs = [1, 2].map((id) => ({
    id: String(id),
    title: `Song ${id}`,
    artist: "Artist",
    duration: 180,
    streamUrl: `https://example.test/${id}.mp3`,
  }));
  await act(() => controls.startQueue(songs, "Test", 0));
  assert.equal(sources.length, 1);
  const filters = nodes.filter((node) => node.kind === "filter" && node.type === "peaking");
  assert.equal(filters.length, 10, "EQ exists without creating the optional FX rack");
  await act(() => controls.setEqGains([6, 5, 4, 3, 2, 1, 0, -1, -2, -3]));
  assert.equal(filters[0].gain.value, 6);
  const beforeTicks = renders;
  await act(() => tick(1));
  await act(() => tick(2));
  assert.equal(progress, 2);
  assert.equal(renders, beforeTicks, "catalogue does not subscribe to playback position");
  await act(() => controls.setMobileNavOpen(true));
  assert.equal(drawerOpen, true);
  assert.equal(renders, beforeTicks, "opening the drawer does not redraw the catalogue");
  await act(() => controls.setMobileNavOpen(false));
  assert.equal(drawerOpen, false);
  assert.equal(renders, beforeTicks);
  const firstInput = sources[0].connections[0];
  await act(() => controls.stepTrack(1));
  assert.equal(sources.length, 2);
  assert.deepEqual(sources[0].connections, []);
  assert.notEqual(sources[1].handle, sources[0].handle, "each track owns a fresh native loader");
  assert.equal(
    sources[1].connections[0],
    firstInput,
    "new source is routed through the existing rack"
  );
  assert.equal(filters[0].gain.value, 6);
  assert.equal(
    nodes.filter((node) => node.kind === "filter" && node.type === "peaking").length,
    10
  );
  await act(() => renderer.unmount());
});

test("Liked Songs to Home retires old playback and ignores late native callbacks", async () => {
  const h = audioHarness({ manualLoad: true });
  let controls;
  let progress;
  function Screen() {
    controls = h.player.useMusicPlayer();
    progress = h.player.usePlaybackProgress().progress;
    return null;
  }
  let renderer;
  await act(() => {
    renderer = create(
      React.createElement(h.player.MusicPlayerProvider, null, React.createElement(Screen))
    );
  });
  const liked = {
    id: "liked",
    title: "Liked",
    artist: "Artist",
    duration: 180,
    streamUrl: "https://example.test/liked.mp3",
  };
  const home = { ...liked, id: "home", title: "Home", streamUrl: "https://example.test/home.mp3" };
  await act(() => {
    controls.startQueue([liked], "Liked songs", 0);
    assert.equal(
      h.lyricPrefetches.at(-1),
      liked.id,
      "lyrics start on the tap before the panel mounts or audio loads"
    );
  });
  assert.equal(
    h.events.some(([event]) => event === "play"),
    false,
    "preload must finish before play can start another native load"
  );
  const old = h.instances[0];
  assert.equal(controls.loading, true);
  await act(() => old.props.onLoad());
  assert.equal(controls.loading, false);
  await act(() => old.props.onWaiting());
  assert.equal(controls.loading, true);
  await act(() => old.props.onPlaying());
  assert.equal(controls.loading, false);
  assert.equal(old.playing, true);
  await act(() => controls.startQueue([home], "Home", 0));
  assert.equal(controls.loading, true);
  assert.equal(old.playing, false, "the liked song stops before the Home song loads");
  assert.deepEqual(h.sources[0].connections, [], "old audio is detached from the shared EQ graph");
  const next = h.instances[1];
  assert.ok(next, "new track owns a separate native loader");
  await act(() => next.props.onLoad());
  assert.deepEqual(
    h.instances.filter((entry) => entry.playing).map((entry) => entry.source),
    [home.streamUrl]
  );
  const before = h.events.length;
  await act(() => {
    old.props.onLoad();
    old.props.onPlay();
    old.props.onPause();
    old.props.onPositionChange(99);
    old.props.onEnded();
    old.props.onError(new Error("late failure"));
    old.props.onWaiting();
  });
  assert.equal(h.events.length, before, "retired callbacks cannot restart either source");
  assert.equal(controls.current.id, home.id);
  assert.equal(controls.playing, true);
  assert.equal(progress, 0);
  assert.equal(controls.playerError, null);
  assert.equal(controls.loading, false);
  // Different catalogue records can resolve to the same stream URL.
  await act(() => controls.startQueue([{ ...home, id: "same-url" }], "Home", 0));
  assert.equal(next.playing, false);
  assert.equal(h.instances.length, 3);
  await act(() => controls.togglePlay());
  await act(() => h.instances[2].props.onLoad());
  assert.equal(
    h.instances.some((entry) => entry.playing),
    false,
    "pause during preload is respected"
  );
  await act(() => controls.togglePlay());
  assert.equal(h.instances.filter((entry) => entry.playing).length, 1);
  await act(() => renderer.unmount());
  assert.equal(
    h.instances.some((entry) => entry.playing),
    false
  );
});

test("an offline lookup cannot keep the old song playing or replace a newer Home selection", async () => {
  let resolveFile;
  const h = audioHarness({
    openPlaybackUrl: () =>
      new Promise((resolve) => {
        resolveFile = resolve;
      }),
  });
  let controls;
  function Screen() {
    controls = h.player.useMusicPlayer();
    return null;
  }
  let renderer;
  await act(() => {
    renderer = create(
      React.createElement(h.player.MusicPlayerProvider, null, React.createElement(Screen))
    );
  });
  const liked = {
    id: "liked",
    title: "Liked",
    artist: "Artist",
    duration: 180,
    streamUrl: "https://example.test/liked.mp3",
  };
  await act(() => controls.startQueue([liked], "Liked songs", 0));
  await act(() =>
    controls.startQueue(
      [{ ...liked, id: "offline", offline: { id: "saved-copy" } }],
      "Liked songs",
      0
    )
  );
  assert.equal(
    h.instances.some((entry) => entry.playing),
    false,
    "old song stops while the file lookup is pending"
  );
  const home = { ...liked, id: "home", streamUrl: "https://example.test/home.mp3" };
  await act(() => controls.startQueue([home], "Home", 0));
  await act(async () => resolveFile("file:///old-selection.mp3"));
  assert.equal(controls.current.id, home.id);
  assert.deepEqual(
    h.instances.filter((entry) => entry.playing).map((entry) => entry.source),
    [home.streamUrl]
  );
  await act(() => renderer.unmount());
});

test("Expo Go disposal pauses audio before releasing it and ignores late events", () => {
  const events = [];
  let status;
  const nativePlayer = {
    addListener(_name, callback) {
      status = callback;
      return {
        remove() {
          events.push("unsubscribe");
        },
      };
    },
    pause() {
      events.push("pause");
    },
    remove() {
      events.push("remove");
    },
    play() {
      events.push("play");
    },
  };
  const { createGoAudioTransport } = load("lib/go-audio.ts", {
    expo: { isRunningInExpoGo: () => false },
    "expo-constants": { default: { executionEnvironment: "bare" }, __esModule: true },
    "expo-audio": { createAudioPlayer: () => nativePlayer, setAudioModeAsync: async () => {} },
  });
  const transport = createGoAudioTransport(
    "test.mp3",
    {
      onLoad() {
        events.push("load");
      },
      onPlay() {
        events.push("playing");
      },
      onPositionChange() {
        events.push("position");
      },
      onPause() {},
      onEnded() {},
      onError() {},
    },
    { volume: 1, muted: false, rate: 1 }
  );
  transport.handle.play();
  transport.dispose();
  transport.dispose();
  transport.handle.play();
  status({ isLoaded: true, duration: 180, playing: true, currentTime: 20 });
  assert.deepEqual(events, ["play", "unsubscribe", "pause", "remove"]);
});

test("drawer occupies the native screen, opens sections, and dismisses by backdrop or Back", async () => {
  let back;
  let controls;
  let bodyReads = 0;
  let logouts = 0;
  const navigations = [];
  const native = {
    View: "View",
    Text: "Text",
    TextInput: "TextInput",
    Image: "Image",
    Pressable: "Pressable",
    ScrollView: "ScrollView",
    useWindowDimensions: () => ({ width: 360, height: 800 }),
    StyleSheet: { absoluteFill: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 } },
    BackHandler: {
      addEventListener: (_event, callback) => {
        back = callback;
        return {
          remove() {
            back = null;
          },
        };
      },
    },
  };
  const motion = {
    duration: (milliseconds) => ({
      milliseconds,
      easing() {
        return this;
      },
      reduceMotion() {
        return this;
      },
    }),
  };
  const { SideBar } = load(
    "components/features/music/SideBar.tsx",
    {
      "react-native": native,
      "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 24, bottom: 16 }) },
      "expo-router": { Link: "Link", useRouter: () => ({ navigate() {} }) },
      "@/components/providers/CustomizationProvider": {
        useCustomization: () => ({ personal: false }),
      },
      "react-native-reanimated": {
        __esModule: true,
        default: { View: "AnimatedView" },
        useSharedValue: (value) => React.useRef({ value }).current,
        useAnimatedStyle: (fn) => fn(),
        withSpring: (value) => value,
        SlideInLeft: motion,
        SlideOutLeft: motion,
        FadeIn: motion,
        FadeOut: motion,
        Easing: { cubic: (x) => x, in: (fn) => fn, out: (fn) => fn },
        ReduceMotion: { System: "system" },
      },
      uniwind: { useCSSVariable: () => "#101419" },
      "@/hooks/usePanelBackHandler": load("hooks/usePanelBackHandler.ts", {
        "react-native": native,
      }),
      "heroui-native": {
        Slider: Object.assign(() => null, { Track: "Track", Fill: "Fill", Thumb: "Thumb" }),
      },
      "@/lib/cn": { cn: (...values) => values.filter(Boolean).join(" ") },
      "@/components/ui/icons": { Icon: "Icon" },
      "@/components/ui/ConfirmDialog": { ConfirmDialog: "ConfirmDialog" },
      "@/components/features/music/EqBars": { EqBars: "EqBars" },
      "@/lib/format": { formatRuntime: () => "0:00" },
      "@/components/providers/AuthProvider": {
        useAuth: () => ({
          user: { name: "Listener" },
          status: "authenticated",
          logout: async () => {
            logouts++;
          },
        }),
      },
      "@/components/providers/GuestLockProvider": {
        useGuestLock: () => ({ requireAuth: () => true }),
      },
      "@/components/providers/LibraryProvider": {
        useLibrary: () => {
          bodyReads++;
          return { liked: [], playlists: [] };
        },
      },
      "@/components/providers/CommunityProvider": {
        useCommunity: () => ({ chatOpen: false, badge: 0 }),
      },
      "@/components/providers/ThemeProvider": { useTheme: () => ({ resolved: "dark" }) },
      "@/components/providers/MusicPlayerProvider": {
        useMusicPlayer: () => controls,
        useMobileNavOpen: () => controls.mobileNavOpen,
        usePlaybackProgress: () => ({ listenedSeconds: 0 }),
        EQ_PRESETS: [{ label: "Flat" }],
        SPATIAL_MODES: [],
      },
    },
    { setTimeout: (fn) => fn() }
  );
  function Shell() {
    const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
    controls = {
      mobileNavOpen,
      setMobileNavOpen,
      getGraphInfo: () => ({}),
      queue: [],
      index: -1,
      volume: 0.5,
      rate: 1,
      eqPreset: "Flat",
      spatialMode: "off",
    };
    return React.createElement(SideBar, {
      onBrowse: () => navigations.push("top"),
      onRegions: () => navigations.push("regions"),
      onLibraryList: () => navigations.push("library"),
    });
  }
  let renderer;
  await act(() => {
    renderer = create(React.createElement(Shell));
  });
  assert.equal(renderer.toJSON(), null);
  assert.equal(bodyReads, 0, "closed drawer does not render hidden controls");
  await act(() => controls.setMobileNavOpen(true));
  const overlay = renderer.root
    .findAllByType("AnimatedView")
    .find((view) => view.props.accessibilityViewIsModal);
  assert.equal(overlay.props.style[0].position, "absolute");
  assert.equal(overlay.props.style[0].bottom, 0);
  const panel = renderer.root.findByProps({ accessibilityLabel: "ZYRAVA dock" });
  assert.equal(panel.props.style[0].width, 309.6);
  assert.equal(panel.props.style[0].top, 0);
  assert.equal(panel.props.entering.milliseconds, 200);
  assert.equal(panel.props.exiting.milliseconds, 160);
  await act(() => {
    assert.equal(back(), true);
  });
  assert.equal(renderer.toJSON(), null);
  assert.equal(back, null);
  await act(() => controls.setMobileNavOpen(true));
  const backdrop = renderer.root
    .findAllByType("Pressable")
    .find((view) => view.props.accessibilityLabel === "Close the dock");
  await act(() => backdrop.props.onPress());
  assert.equal(renderer.toJSON(), null);
  await act(() => controls.setMobileNavOpen(true));
  const section = renderer.root
    .findAllByType("Pressable")
    .find((view) =>
      view.findAllByType("Text").some((text) => text.props.children === "Top of the page")
    );
  assert.ok(section);
  await act(() => section.props.onPress());
  assert.deepEqual(navigations, ["top"]);
  assert.equal(renderer.toJSON(), null);
  await act(() => controls.setMobileNavOpen(true));
  await act(() => renderer.root.findByProps({ accessibilityLabel: "Sign out" }).props.onPress());
  assert.equal(logouts, 0, "tapping sign out only asks for confirmation");
  assert.equal(controls.mobileNavOpen, false);
  await act(() => renderer.root.findByProps({ title: "Sign out of ZYRAVA?" }).props.onCancel());
  assert.equal(logouts, 0, "cancel keeps the account signed in");
  assert.equal(renderer.toJSON(), null);
  await act(() => controls.setMobileNavOpen(true));
  await act(() => renderer.root.findByProps({ accessibilityLabel: "Sign out" }).props.onPress());
  await act(() => renderer.root.findByProps({ title: "Sign out of ZYRAVA?" }).props.onConfirm());
  assert.equal(logouts, 1, "only explicit confirmation logs out");
  await act(() => renderer.unmount());
});

test("rebinding still connects the new track when the previous source was disposed", () => {
  const { bindPlaybackSource } = load("lib/playback-graph.ts");
  const input = {};
  const analyser = {};
  const connected = [];
  const source = { connect: (node) => connected.push(node) };
  assert.equal(
    bindPlaybackSource(
      { createMediaElementSource: () => source },
      {},
      {
        disconnect() {
          throw new Error("disposed");
        },
      },
      input,
      analyser
    ),
    source
  );
  assert.deepEqual(connected, [input, analyser]);
});

test("volume is linear in Expo Go and system mode avoids double attenuation", async () => {
  for (const deviceVolume of [null, 0.6]) {
    const writes = [];
    const h = audioHarness({ deviceVolume, setDeviceVolume: (v) => writes.push(v) });
    let controls;
    function Screen() {
      controls = h.player.useMusicPlayer();
      return null;
    }
    let renderer;
    await act(() => {
      renderer = create(
        React.createElement(h.player.MusicPlayerProvider, null, React.createElement(Screen))
      );
    });
    assert.equal(h.player.appliedVolume(0.01), 0.01);
    assert.equal(h.player.appliedVolume(NaN), 0);
    assert.deepEqual(writes, [], "mount must not change phone volume");
    await act(() =>
      controls.startQueue(
        [
          {
            id: "volume",
            title: "Song",
            duration: 180,
            streamUrl: "https://example.test/volume.mp3",
          },
        ],
        "Test",
        0
      )
    );
    const master = h.nodes.find(
      (node) => node.kind === "gain" && node.connections.includes(node.context.destination)
    );
    assert.ok(master);
    assert.equal(master.gain.value, 1);
    await act(() => controls.setVolume(0.2));
    assert.equal(master.gain.value, deviceVolume === null ? 0.2 : 1);
    assert.equal(controls.volumeIsDevice, deviceVolume !== null);
    assert.deepEqual(writes, deviceVolume === null ? [] : [0.2]);
    await act(() => controls.setMuted(true));
    assert.equal(master.gain.value, 0);
    await act(() => renderer.unmount());
  }
});

test("Expo Go keeps a buffering spinner when the transport still reports playing", () => {
  let status, buffering;
  const { createGoAudioTransport } = load("lib/go-audio.ts", {
    expo: { isRunningInExpoGo: () => false },
    "expo-constants": { default: { executionEnvironment: "bare" }, __esModule: true },
    "expo-audio": {
      setAudioModeAsync: async () => {},
      createAudioPlayer: () => ({
        addListener(_event, callback) {
          status = callback;
          return { remove() {} };
        },
        pause() {},
        remove() {},
      }),
    },
  });
  const transport = createGoAudioTransport(
    "song.mp3",
    {
      onLoad() {
        buffering = false;
      },
      onPlay() {
        buffering = false;
      },
      onPause() {},
      onEnded() {},
      onError() {},
      onPositionChange() {},
      onBufferingChange(value) {
        buffering = value;
      },
    },
    { volume: 1, muted: false, rate: 1 }
  );
  status({ isLoaded: true, duration: 180, currentTime: 12, playing: true, isBuffering: true });
  assert.equal(buffering, true);
  status({ isLoaded: true, duration: 180, currentTime: 13, playing: true, isBuffering: false });
  assert.equal(buffering, false);
  transport.dispose();
});

test("notification controls are idempotent and publish small artwork when large artwork is absent", async () => {
  const handlers = new Map();
  const shows = [];
  const enabledControls = new Map();
  let fail = false;
  const notifications = {
    async show(info) {
      if (fail) throw new Error("permission denied");
      shows.push(info);
    },
    async hide() {},
    async enableControl(name, enabled) {
      enabledControls.set(name, enabled);
    },
    addEventListener(name, callback) {
      handlers.set(name, callback);
      return {
        remove() {
          handlers.delete(name);
        },
      };
    },
  };
  const h = audioHarness({ notifications });
  let controls, renderer;
  function Screen() {
    controls = h.player.useMusicPlayer();
    return null;
  }
  await act(() => {
    renderer = create(
      React.createElement(h.player.MusicPlayerProvider, null, React.createElement(Screen))
    );
  });
  await act(() =>
    controls.startQueue(
      [
        {
          id: "remote",
          title: "Song",
          artist: "Artist",
          image: "https://example.test/small.jpg",
          duration: 180,
          streamUrl: "https://example.test/music.mp3",
        },
      ],
      "Test",
      0
    )
  );
  assert.equal(enabledControls.get("nextTrack"), true);
  assert.equal(enabledControls.get("previousTrack"), true);
  assert.equal(enabledControls.get("skipForward"), false);
  assert.equal(enabledControls.get("skipBackward"), false);
  assert.equal(shows.at(-1).title, "Song");
  assert.deepEqual(shows.at(-1).artwork, { uri: "https://example.test/small.jpg" });
  await act(() => {
    handlers.get("playbackNotificationPause")();
    handlers.get("playbackNotificationPause")();
  });
  assert.equal(controls.playing, false);
  await act(() => {
    handlers.get("playbackNotificationPlay")();
    handlers.get("playbackNotificationPlay")();
  });
  assert.equal(controls.playing, true);
  fail = true;
  await act(() => handlers.get("playbackNotificationPause")());
  assert.equal(controls.playing, false, "notification failure must not crash playback state");
  await act(() => renderer.unmount());
  assert.equal(handlers.size, 0);
});

test("Expo remote pause remains paused and remote resume restores playback", async () => {
  const h = audioHarness({ go: true });
  let controls, renderer;
  function Screen() {
    controls = h.player.useMusicPlayer();
    return null;
  }
  await act(() => {
    renderer = create(
      React.createElement(h.player.MusicPlayerProvider, null, React.createElement(Screen))
    );
  });
  await act(() =>
    controls.startQueue(
      [{ id: "remote", title: "Song", duration: 180, streamUrl: "https://example.test/music.mp3" }],
      "Test",
      0
    )
  );
  const instance = h.instances[0];
  await act(() => instance.props.onLoad(180));
  await act(() => instance.props.onPause());
  assert.equal(controls.playing, false);
  await act(() => instance.props.onPlay());
  assert.equal(controls.playing, true);
  await act(() => renderer.unmount());
});

for (const go of [false, true]) {
  test(`${go ? "Expo Go" : "native"} instrumental karaoke keeps time, EQ, and only one player`, async () => {
    const instrumentals = new Map([
      ["song", { uri: "file:///instrumental.mp3", name: "Instrumental.mp3" }],
    ]);
    const h = audioHarness({ go, instrumentals, manualLoad: true });
    let controls, clock, renderer;
    function Screen() {
      controls = h.player.useMusicPlayer();
      clock = h.player.usePlaybackProgress();
      return null;
    }
    await act(() => {
      renderer = create(
        React.createElement(h.player.MusicPlayerProvider, null, React.createElement(Screen))
      );
    });
    const song = {
      id: "song",
      title: "Song",
      artist: "Artist",
      duration: 180,
      streamUrl: "https://example.test/original.mp3",
    };
    await act(() => controls.startQueue([song], "Home", 0));
    const original = h.instances.at(-1);
    await act(() => original.props.onLoad(180));
    await act(() => original.props.onPositionChange(42));
    await act(() => controls.setEqGains([6, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    await act(() => controls.chooseInstrumental());
    const backing = h.instances.at(-1);
    assert.equal(original.playing, false);
    assert.equal(backing.source, "file:///instrumental.mp3");
    await act(async () => backing.props.onLoad(180));
    assert.equal(backing.position, 42);
    assert.equal(controls.current.id, "song");
    assert.equal(clock.progress, 42);
    assert.equal(controls.karaokePreparing, false);
    assert.equal(controls.instrumentalName, "Instrumental.mp3");
    assert.equal(h.instances.filter((entry) => entry.playing).length, 1);
    if (!go) assert.equal(h.nodes.find((node) => node.type === "peaking").gain.value, 6);
    await act(() => {
      original.props.onPositionChange(90);
      original.props.onError(new Error("old source"));
    });
    assert.equal(clock.progress, 42);
    assert.equal(controls.playerError, null);
    await act(() => controls.togglePlay());
    await act(() => controls.setKaraoke(false));
    const restored = h.instances.at(-1);
    await act(async () => restored.props.onLoad(180));
    assert.equal(restored.source, song.streamUrl);
    assert.equal(restored.position, 42);
    assert.equal(
      h.instances.filter((entry) => entry.playing).length,
      0,
      "switching files preserves pause intent"
    );
    await act(() => renderer.unmount());
  });
}

test("a late instrumental selection never replaces a different song", async () => {
  const instrumentals = new Map();
  let resolvePick;
  const h = audioHarness({
    instrumentals,
    pickInstrumental: (id) =>
      new Promise((resolve) => {
        resolvePick = () => {
          const file = { uri: "file:///backing.mp3", name: "Backing.mp3" };
          instrumentals.set(id, file);
          resolve(file);
        };
      }),
  });
  let controls, renderer;
  function Screen() {
    controls = h.player.useMusicPlayer();
    return null;
  }
  await act(() => {
    renderer = create(
      React.createElement(h.player.MusicPlayerProvider, null, React.createElement(Screen))
    );
  });
  const songs = [1, 2].map((id) => ({
    id: String(id),
    title: `Song ${id}`,
    duration: 180,
    streamUrl: `https://example.test/${id}.mp3`,
  }));
  await act(() => controls.startQueue(songs, "Home", 0));
  await act(() => {
    void controls.chooseInstrumental();
  });
  assert.equal(controls.karaokeSelecting, true);
  await act(() => controls.stepTrack(1));
  await act(async () => resolvePick());
  assert.equal(controls.current.id, "2");
  assert.equal(controls.karaokeOn, false);
  assert.equal(h.instances.at(-1).source, songs[1].streamUrl);
  assert.equal(
    instrumentals.has("1"),
    true,
    "file remains paired with the song it was selected for"
  );
  await act(() => renderer.unmount());
});

test("a rejected instrumental restores the original without turning on vocal reduction", async () => {
  const instrumentals = new Map([["song", { uri: "file:///bad.mp3", name: "Bad.mp3" }]]);
  const h = audioHarness({ instrumentals });
  let controls, renderer;
  function Screen() {
    controls = h.player.useMusicPlayer();
    return null;
  }
  await act(() => {
    renderer = create(
      React.createElement(h.player.MusicPlayerProvider, null, React.createElement(Screen))
    );
  });
  const song = {
    id: "song",
    title: "Song",
    duration: 180,
    streamUrl: "https://example.test/original.mp3",
  };
  await act(() => controls.startQueue([song], "Home", 0));
  await act(() => controls.chooseInstrumental());
  await act(() => h.instances.at(-1).props.onError(new Error("bad format")));
  assert.equal(controls.karaokeOn, false);
  assert.match(controls.karaokeError, /Original audio restored/);
  assert.equal(h.instances.at(-1).source, song.streamUrl);
  await act(() => renderer.unmount());
});

async function mountPlayer(options = {}) {
  const h = audioHarness(options);
  let controls;
  function Screen() {
    controls = h.player.useMusicPlayer();
    return null;
  }
  let renderer;
  await act(() => {
    renderer = create(
      React.createElement(h.player.MusicPlayerProvider, null, React.createElement(Screen))
    );
  });
  const songs = [1, 2].map((id) => ({
    id: String(id),
    title: `Song ${id}`,
    artist: "Artist",
    duration: 180,
    streamUrl: `https://example.test/${id}.mp3`,
  }));
  await act(() => controls.startQueue(songs, "Test", 0));
  return { ...h, renderer, controls: () => controls, unmount: () => act(() => renderer.unmount()) };
}

test("Karaoke reduces the current native song without selecting a file, seeking or reloading", async () => {
  let picks = 0;
  const h = await mountPlayer({
    instrumentals: new Map([["1", { uri: "file:///different.mp3", name: "Saved.mp3" }]]),
    pickInstrumental: async () => {
      picks++;
      return null;
    },
  });
  try {
    const original = h.instances.at(-1),
      count = h.instances.length;
    await act(() => original.props.onPositionChange(42));
    const eventStart = h.events.length;
    await act(() => h.controls().setKaraoke(true));
    assert.equal(h.controls().karaokeOn, true);
    assert.equal(h.controls().instrumentalPlaying, false);
    assert.equal(picks, 0);
    assert.equal(h.instances.length, count);
    assert.equal(h.instances.at(-1), original);
    assert.ok(h.nodes.some((n) => n.gain?.value === -0.9));
    assert.ok(!h.events.slice(eventStart).some((e) => e[0] === "seek" || e[0] === "pause"));
    await act(() => h.controls().togglePlay());
    await act(() => h.controls().setKaraoke(false));
    assert.equal(h.controls().playing, false);
    assert.ok(!h.nodes.some((n) => n.gain?.value === -0.9));
    await act(() => h.controls().setKaraoke(true));
    await act(() => h.controls().stepTrack(1));
    assert.equal(h.controls().karaokeOn, false, "karaoke follows the current song only");
    assert.ok(!h.nodes.some((n) => n.gain?.value === -0.9));
  } finally {
    await h.unmount();
  }
});

test("Space modes work without the DJ rack and release their nodes when switched off", async () => {
  const h = await mountPlayer();
  try {
    // This context intentionally has no convolver or waveshaper. Space must
    // not attempt to construct the optional DJ rack to become audible.
    for (const mode of h.player.SPATIAL_MODES) {
      const start = h.nodes.length;
      await act(() => h.controls().setSpatialMode(mode.value));
      assert.equal(h.controls().spatialMode, mode.value);
      assert.equal(h.controls().processingError, null);
      const created = h.nodes.slice(start);
      if (mode.value !== "off" && mode.value !== "stereo")
        assert.ok(created.length > 0, `${mode.value} creates an audible processing path`);
      if (mode.value === "telephone") {
        const band = created.find((node) => node.type === "bandpass");
        assert.equal(band.frequency.value, 1400);
        assert.equal(band.Q.value, 1.1);
      }
      if (mode.value === "8d" || mode.value === "pan") {
        assert.equal(
          created.find((node) => node.kind === "oscillator").frequency.value,
          mode.value === "8d" ? 0.08 : 0.45
        );
      }
      if (mode.value === "echo")
        assert.equal(created.find((node) => node.kind === "delay").delayTime.value, 0.32);
      if (mode.value === "surround")
        assert.deepEqual(
          created.filter((node) => node.kind === "delay").map((node) => node.delayTime.value),
          [0.018, 0.018]
        );
      await act(() => h.controls().setSpatialMode("off"));
      for (const node of created) {
        assert.deepEqual(node.connections, [], `${mode.value} disconnects retired nodes`);
        if (node.kind === "oscillator") assert.equal(node.stopped, true);
      }
    }
  } finally {
    await h.unmount();
  }
});

test("EQ presets use the web curve and headroom, and Custom and Space survive track changes", async () => {
  const h = await mountPlayer();
  try {
    const bands = h.nodes.filter((node) => node.type === "peaking");
    assert.deepEqual(
      bands.map((node) => node.frequency.value),
      [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
    );
    await act(() =>
      h.controls().applyPreset(h.player.EQ_PRESETS.find((preset) => preset.label === "Bass boost"))
    );
    const expected = [9, 7.5, 5, 2.5, 0, -0.5, -1, -1, 0, 0.5];
    assert.deepEqual(
      bands.map((node) => node.gain.value),
      expected
    );
    const trim = bands.at(-1).connections[0];
    const rms = Math.sqrt(expected.reduce((sum, gain) => sum + gain * gain, 0) / 10);
    assert.ok(Math.abs(trim.gain.value - Math.pow(10, -(9 + rms) / 40)) < 1e-10);
    const custom = [4, 3, 2, 1, 0, -1, -2, -3, -4, -5];
    await act(() => {
      h.controls().setEqGains(custom);
      h.controls().markEqCustom(custom);
    });
    await act(() => h.controls().applyPreset(h.player.EQ_PRESETS[0]));
    assert.equal(trim.gain.value, 1);
    await act(() => h.controls().applyCustomPreset());
    await act(() => h.controls().setSpatialMode("telephone"));
    const spaceIn = trim.connections[0].connections[0].connections[0];
    const modeNode = spaceIn.connections[0];
    assert.equal(modeNode.type, "bandpass");
    await act(() => h.controls().stepTrack(1));
    assert.deepEqual(
      bands.map((node) => node.gain.value),
      custom
    );
    assert.equal(spaceIn.connections[0], modeNode);
    assert.equal(h.controls().spatialMode, "telephone");
    await act(() => h.controls().setSpatialMode("stereo"));
    assert.deepEqual(modeNode.connections, []);
    assert.equal(spaceIn.connections.length, 1);
    assert.equal(spaceIn.connections[0].kind, "gain");
  } finally {
    await h.unmount();
  }
});

test("failed Space mode removes partial paths and reports a clean bypass", async () => {
  const h = await mountPlayer({ failDelay: true });
  try {
    const trim = h.nodes.filter((node) => node.type === "peaking").at(-1).connections[0];
    const input = trim.connections[0].connections[0].connections[0];
    const output = input.connections[0];
    const count = h.nodes.length;
    await act(() => h.controls().setSpatialMode("echo"));
    assert.equal(h.controls().spatialMode, "off");
    assert.equal(h.controls().karaokeOn, false);
    assert.match(h.controls().processingError, /Space could not start/);
    assert.deepEqual(input.connections, [output]);
    for (const node of h.nodes.slice(count)) assert.deepEqual(node.connections, []);
    await act(() => h.controls().setSpatialMode("telephone"));
    assert.equal(h.controls().processingError, null);
    assert.equal(input.connections[0].type, "bandpass");
  } finally {
    await h.unmount();
  }
});

test("Expo Go does not falsely engage EQ or Space", async () => {
  const h = await mountPlayer({ go: true });
  try {
    await act(() => {
      h.controls().applyPreset(h.player.EQ_PRESETS[1]);
      h.controls().setEqGains(Array(10).fill(6));
      h.controls().markEqCustom(Array(10).fill(6));
      h.controls().applyCustomPreset();
      h.controls().setSpatialMode("wide");
    });
    assert.equal(h.controls().eqPreset, "Flat");
    assert.deepEqual(h.controls().eqGains, Array(10).fill(0));
    assert.equal(h.controls().spatialMode, "off");
  } finally {
    await h.unmount();
  }
});

test("EQ fader double-tap reset survives a late native measurement and disabled faders cannot drag", async () => {
  const filename = path.resolve(__dirname, "../src/components/features/music/MixerConsole.tsx");
  const source = ts.createSourceFile(
    filename,
    readFileSync(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const declaration = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "FaderStrip"
  );
  assert.ok(declaration);
  const code = ts.transpileModule(declaration.getText(source), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  let now = 1000;
  const pendingMeasurements = [];
  const changes = [];
  const Fader = new Function(
    "exports",
    "require",
    "useRef",
    "useEffect",
    "View",
    "Text",
    "PanResponder",
    "cn",
    "Date",
    `${code}; return FaderStrip;`
  )(
    {},
    require,
    React.useRef,
    React.useEffect,
    "View",
    "Text",
    { create: (handlers) => ({ panHandlers: handlers }) },
    (...items) => items.filter(Boolean).join(" "),
    { now: () => now }
  );
  let renderer;
  const props = { label: "1k", value: 4, onChange: (value) => changes.push(value) };
  await act(() => {
    renderer = create(React.createElement(Fader, props), {
      createNodeMock: () => ({ measureInWindow: (callback) => pendingMeasurements.push(callback) }),
    });
  });
  const rail = () => renderer.root.findByProps({ accessibilityRole: "adjustable" });
  await act(() => rail().props.onPanResponderGrant({}, { y0: 120 }));
  now += 100;
  await act(() => rail().props.onPanResponderGrant({}, { y0: 130 }));
  await act(() => pendingMeasurements[0](0, 100));
  assert.deepEqual(changes, [0], "late measure must not overwrite the double-tap reset");
  await act(() => rail().props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }));
  assert.equal(changes.at(-1), 4.5);
  await act(() => renderer.update(React.createElement(Fader, { ...props, disabled: true })));
  assert.equal(rail().props.onPanResponderGrant, undefined);
  assert.deepEqual(rail().props.accessibilityActions, []);
  await act(() => renderer.unmount());
});

test("Expo Go reuses one effects player across Flat, EQ and Space and safely falls back on error", async () => {
  const h = await mountPlayer({ go: true, goEffects: true });
  try {
    const host = h.renderer.root.findByType("GoEqualizerHost").props;
    const loads = [],
      commands = [];
    await act(() =>
      host.bridge.attach({
        load: (id, source) => loads.push({ id, source }),
        post: (command) => commands.push(command),
        cancel() {},
      })
    );
    await act(() => host.onAvailable(true));
    assert.equal(h.instances.length, 0, "no second native player competes with the effects source");
    assert.equal(loads.length, 1);
    assert.equal(h.controls().getGraphInfo().spatial, true);
    assert.equal(
      h.controls().getGraphInfo().webAudio,
      false,
      "the studio rack still requires native DSP"
    );
    host.bridge.begin(loads[0].id);
    await act(() => host.bridge.receive({ id: loads[0].id, type: "loaded", duration: 180 }));
    await act(() => host.bridge.receive({ id: loads[0].id, type: "play" }));
    await act(() => host.bridge.receive({ id: loads[0].id, type: "position", time: 42 }));
    await act(() => h.controls().setKaraoke(true));
    assert.equal(h.controls().karaokeOn, true);
    assert.equal(h.controls().instrumentalPlaying, false);
    assert.equal(commands.at(-1).type, "karaoke");
    assert.equal(commands.at(-1).enabled, true);
    assert.equal(loads.length, 1, "karaoke processes the current stream without a new source");
    const before = commands.length;
    for (const preset of [
      h.player.EQ_PRESETS[1],
      h.player.EQ_PRESETS[0],
      h.player.EQ_PRESETS[2],
      h.player.EQ_PRESETS[0],
    ]) {
      await act(() => h.controls().applyPreset(preset));
    }
    for (const mode of h.player.SPATIAL_MODES) {
      await act(() => h.controls().setSpatialMode(mode.value));
      assert.equal(h.controls().spatialMode, mode.value);
    }
    await act(() => h.controls().setSpatialMode("off"));
    assert.equal(loads.length, 1, "neither Flat nor Space restarts the download");
    assert.equal(h.instances.length, 0);
    assert.ok(
      commands.slice(before).every((command) => command.type === "eq" || command.type === "space")
    );
    assert.equal(commands.at(-1).mode, "off");
    await act(() => h.controls().togglePlay());
    await act(() => host.bridge.receive({ id: loads[0].id, type: "pause" }));
    const afterPause = commands.length;
    await act(() => h.controls().applyPreset(h.player.EQ_PRESETS[1]));
    await act(() => h.controls().applyPreset(h.player.EQ_PRESETS[0]));
    assert.equal(h.controls().playing, false);
    assert.ok(!commands.slice(afterPause).some((command) => command.type === "play"));
    await act(() => h.controls().togglePlay());
    await act(() => host.bridge.receive({ id: loads[0].id, type: "play" }));
    await act(() => host.bridge.receive({ id: loads[0].id, type: "position", time: 51 }));
    await act(() =>
      host.bridge.receive({ id: loads[0].id, type: "error", message: "Decode failed" })
    );
    assert.ok(commands.some((command) => command.type === "mute" && command.muted));
    assert.ok(commands.some((command) => command.type === "stop"));
    assert.equal(h.controls().getGraphInfo().equalizer, false);
    assert.equal(h.controls().getGraphInfo().spatial, false);
    assert.equal(h.controls().eqPreset, "Flat");
    assert.equal(h.controls().spatialMode, "off");
    assert.equal(h.controls().karaokeOn, false);
    assert.match(h.controls().processingError, /Original playback restored/);
    assert.equal(h.instances.length, 1);
    await act(() => h.instances[0].props.onLoad(180));
    assert.equal(h.instances[0].position, 51);
    assert.equal(h.instances[0].playing, true);
    await act(() => host.bridge.receive({ id: loads[0].id, type: "play" }));
    await act(() => host.bridge.receive({ id: loads[0].id, type: "error", message: "stale" }));
    assert.equal(h.instances.length, 1, "late events cannot resurrect the disposed effects player");
    await act(() => h.controls().stepTrack(1));
    assert.equal(h.instances[0].playing, false);
    assert.equal(loads.length, 2, "a new track can retry effects after a per-track failure");
  } finally {
    await h.unmount();
  }
});

test("background progress does not remount native audio or redraw the clock", async () => {
  const h = audioHarness();
  let controls, clock, renderer;
  function Screen() {
    controls = h.player.useMusicPlayer();
    clock = h.player.usePlaybackProgress();
    return null;
  }
  await act(() => {
    renderer = create(
      React.createElement(h.player.MusicPlayerProvider, null, React.createElement(Screen))
    );
  });
  await act(() =>
    controls.startQueue(
      [
        {
          id: "background",
          title: "Song",
          duration: 180,
          streamUrl: "https://example.test/song.mp3",
        },
      ],
      "Test",
      0
    )
  );
  await act(() => h.tick(12));
  await act(() => h.appState("background"));
  await act(() => h.tick(13));
  assert.equal(clock.progress, 12);
  for (let i = 0; i < 4; i++) await act(() => h.watchdog());
  assert.equal(h.instances.length, 1, "stale background ticks do not reload the source");
  assert.equal(h.instances[0].playing, true);
  await act(() => h.appState("active"));
  assert.equal(clock.progress, 13, "foreground UI catches up to the latest audio position");
  await act(() => renderer.unmount());
});

test("stream recovery resumes the latest position instead of the original zero", async () => {
  const h = audioHarness();
  let controls, renderer;
  function Screen() {
    controls = h.player.useMusicPlayer();
    return null;
  }
  await act(() => {
    renderer = create(
      React.createElement(h.player.MusicPlayerProvider, null, React.createElement(Screen))
    );
  });
  await act(() =>
    controls.startQueue(
      [{ id: "retry", title: "Song", duration: 180, streamUrl: "https://example.test/song.mp3" }],
      "Test",
      0
    )
  );
  await act(() => h.tick(47));
  await act(() => h.instances[0].props.onError(new Error("network interrupted")));
  await act(() => h.flushTimeouts());
  assert.equal(h.instances.length, 2);
  assert.equal(h.instances.at(-1).position, 47);
  assert.equal(h.instances.at(-1).playing, true);
  await act(() => renderer.unmount());
});

test("a call suspends recovery until audio focus is returned", async () => {
  const h = audioHarness();
  let controls, renderer;
  function Screen() {
    controls = h.player.useMusicPlayer();
    return null;
  }
  await act(() => {
    renderer = create(
      React.createElement(h.player.MusicPlayerProvider, null, React.createElement(Screen))
    );
  });
  await act(() =>
    controls.startQueue(
      [{ id: "focus", title: "Song", duration: 180, streamUrl: "https://example.test/song.mp3" }],
      "Test",
      0
    )
  );
  await act(() => h.tick(10));
  await act(() => h.interrupt({ type: "began", shouldResume: false }));
  await act(() => {
    h.flushTimeouts();
    h.watchdog();
  });
  assert.equal(h.instances[0].playing, false);
  await act(() => h.interrupt({ type: "ended", shouldResume: true }));
  await act(() => h.flushTimeouts());
  assert.equal(h.instances[0].playing, true);
  await act(() => renderer.unmount());
});

test("a paused native track can advance to a playing next track", async () => {
  const h = audioHarness();
  let controls, renderer;
  function Screen() {
    controls = h.player.useMusicPlayer();
    return null;
  }
  await act(() => {
    renderer = create(
      React.createElement(h.player.MusicPlayerProvider, null, React.createElement(Screen))
    );
  });
  const songs = [1, 2].map((id) => ({
    id: String(id),
    title: "Song",
    duration: 180,
    streamUrl: `https://example.test/${id}.mp3`,
  }));
  await act(() => controls.startQueue(songs, "Test", 0));
  await act(() => controls.togglePlay());
  assert.equal(h.instances[0].playing, false);
  await act(() => controls.stepTrack(1));
  assert.equal(h.instances.at(-1).playing, true);
  await act(() => renderer.unmount());
});

test("background queue extension advances without waiting for UI frames", async () => {
  const h = audioHarness();
  let controls, renderer;
  function Screen() {
    controls = h.player.useMusicPlayer();
    return null;
  }
  await act(() => {
    renderer = create(
      React.createElement(h.player.MusicPlayerProvider, null, React.createElement(Screen))
    );
  });
  const songs = [1, 2].map((id) => ({
    id: String(id),
    title: "Song",
    duration: 180,
    streamUrl: `https://example.test/${id}.mp3`,
  }));
  await act(() => controls.startQueue([songs[0]], "Test", 0));
  await act(() => controls.setQueueEnd(() => true));
  await act(() => h.appState("background"));
  await act(() => h.instances[0].props.onEnded());
  await act(() => controls.appendQueue([songs[1]]));
  assert.equal(controls.current.id, "2");
  assert.equal(h.instances.at(-1).playing, true);
  await act(() => renderer.unmount());
});

test("last played card restores paused at its saved position and logout clears it", async () => {
  const { LAST_PLAYED_KEY, serializeLastPlayed } = load("lib/player-memory.ts");
  const song = { id: "remembered", title: "Last played", artist: "Artist", album: "", year: "", language: "english", image: "", imageLarge: "", streamUrl: "https://example.test/last.mp3", pageUrl: "", duration: 180 };
  const storage = new Map([[LAST_PLAYED_KEY, serializeLastPlayed(song, 45)]]);
  const h = audioHarness({ storage });
  let controls;
  let progress;
  function Screen() {
    controls = h.player.useMusicPlayer();
    progress = h.player.usePlaybackProgress().progress;
    return null;
  }
  let renderer;
  await act(() => { renderer = create(React.createElement(h.player.MusicPlayerProvider, null, React.createElement(Screen))); });
  await act(() => h.flushTimeouts());
  assert.equal(controls.current.id, song.id);
  assert.equal(controls.playing, false);
  assert.equal(progress, 45);
  assert.ok(h.events.some(event => event[0] === "seek" && event[1] === 45));
  assert.ok(!h.events.some(event => event[0] === "play"));
  await act(() => controls.endSession());
  await act(() => h.flushTimeouts());
  assert.equal(controls.current, null);
  assert.equal(storage.has(LAST_PLAYED_KEY), false);
  await act(() => renderer.unmount());
});
