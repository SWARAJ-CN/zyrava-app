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

function harness() {
  const playback = {
    playing: true,
    rate: 1,
    progress: 0,
    duration: 30,
    karaokeOn: false,
    karaokeAvailable: true,
    karaokeError: null,
  };
  const karaokeChanges = [];
  const seeks = [];
  const scrolls = [];
  const nativeScrolls = [];
  const translations = [];
  const translate = load("hooks/useLyricTranslation.ts", {
    "@/lib/lyric-translation": {
      translateLyricLines: (texts, language, signal) =>
        new Promise((resolve, reject) =>
          translations.push({ texts, language, signal, resolve, reject })
        ),
    },
  });
  const frames = new Map();
  const timers = new Map();
  let now = 0;
  let sequence = 0;
  const lyrics = load("lib/lyrics.ts");
  const body = {
    kind: "timed",
    lines: lyrics.parseLrc(
      "[00:00]First line\n[00:01]Second line\n[00:02]Third line\n[00:03]Fourth line"
    ),
  };
  let lyricRequests = 0;
  const lyricsCache = load("lib/lyrics-cache.ts", {
    "./lrclib": {
      lookupLyrics: async () => {
        lyricRequests++;
        return {
          status: "found",
          result: { body, matched: { artistName: "Artist", duration: 30 }, drift: false },
        };
      },
    },
  });
  const ScrollView = React.forwardRef(function ScrollView(props, ref) {
    React.useImperativeHandle(
      ref,
      () => ({
        scrollTo: (point) => {
          scrolls.push(point.y);
          nativeScrolls.push(point);
        },
      }),
      []
    );
    return React.createElement("ScrollView", props);
  });
  const { LyricsPanel } = load(
    "components/features/music/LyricsPanel.tsx",
    {
      "react-native": {
        View: "View",
        Text: "Text",
        Pressable: "Pressable",
        ScrollView,
        AccessibilityInfo: {
          isReduceMotionEnabled: async () => false,
          addEventListener: () => ({ remove() {} }),
        },
      },
      "@/components/ui/icons": { Icon: "Icon" },
      "@/components/ui/Modal": { Modal: "Modal" },
      "./LyricLineMotion": { LyricLineMotion: ({ children }) => children },
      "@/hooks/useLyricTranslation": translate,
      "@/lib/lyric-translation": {
        LYRIC_LANGUAGES: [
          ["en", "English"],
          ["hi", "Hindi"],
          ["ml", "Malayalam"],
        ],
      },
      "@/components/providers/MusicPlayerProvider": {
        useMusicPlayer: () => ({
          ...playback,
          seek: (time) => seeks.push(time),
          setKaraoke: (enabled) => {
            karaokeChanges.push(enabled);
            playback.karaokeOn = enabled;
          },
        }),
        usePlaybackProgress: () => playback,
        useKaraokePreparationProgress: () => playback.karaokeProgress ?? null,
      },
      "@/lib/lyrics": lyrics,
      "@/lib/lyrics-cache": lyricsCache,
      "@/lib/cn": { cn: (...values) => values.filter(Boolean).join(" ") },
    },
    {
      performance: { now: () => now },
      Date: class extends Date {
        static now() {
          return now;
        }
      },
      requestAnimationFrame: (fn) => {
        const id = ++sequence;
        frames.set(id, fn);
        return id;
      },
      cancelAnimationFrame: (id) => frames.delete(id),
      setTimeout: (fn) => {
        const id = ++sequence;
        timers.set(id, fn);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    }
  );
  return {
    playback,
    karaokeChanges,
    LyricsPanel,
    lyricsCache,
    lyricRequests: () => lyricRequests,
    seeks,
    scrolls,
    nativeScrolls,
    translations,
    frames,
    runTimers() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((fn) => fn());
    },
    timerCount: () => timers.size,
    advance(ms) {
      now += ms;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((fn) => fn(now));
    },
  };
}

const song = { id: "sync-test", title: "Track", artist: "Artist", album: "Album", duration: 30 };
const selectedText = (renderer) =>
  renderer.root
    .findAllByType("Pressable")
    .filter((node) => node.props.accessibilityState?.selected && node.props.onLayout)
    .map((node) => node.findAllByType("Text")[0].props.children);

test("the highlighted native Text follows playback, pauses, and seeking", async () => {
  const h = harness();
  let renderer;
  const render = () => React.createElement(h.LyricsPanel, { song });
  await act(async () => {
    renderer = create(render());
  });
  await act(() => h.advance(10));
  assert.deepEqual(selectedText(renderer), ["First line"]);
  h.playback.progress = 1.25;
  await act(() => renderer.update(render()));
  await act(() => h.advance(10));
  assert.deepEqual(selectedText(renderer), ["Second line"]);
  const text = renderer.root
    .findAllByType("Text")
    .find((node) => node.props.children === "Second line");
  assert.match(text.props.className, /font-(semibold|bold)/);
  assert.match(text.props.className, /text-foreground/);
  h.playback.playing = false;
  await act(() => renderer.update(render()));
  assert.equal(h.frames.size, 0, "paused lyrics do not keep a frame loop running");
  await act(() => h.advance(3000));
  assert.deepEqual(selectedText(renderer), ["Second line"]);
  h.playback.progress = 2.25;
  await act(() => renderer.update(render()));
  assert.deepEqual(
    selectedText(renderer),
    ["Third line"],
    "seeking while paused updates immediately"
  );
  h.playback.playing = true;
  await act(() => renderer.update(render()));
  await act(() => h.advance(10));
  assert.deepEqual(
    selectedText(renderer),
    ["Third line"],
    "resume rebases the clock rather than advancing by paused time"
  );
  await act(() => h.advance(3000));
  assert.deepEqual(
    selectedText(renderer),
    ["Third line"],
    "a stalled position does not let the lyric clock run away"
  );
  const last = renderer.root.findByProps({ accessibilityLabel: "Fourth line, 0:03" });
  await act(() => last.props.onPress());
  assert.deepEqual(h.seeks, [3]);
  await act(() => renderer.unmount());
  assert.equal(h.frames.size, 0);
});

test("manual scrolling cancels auto-scroll and jump-to-current resumes it", async () => {
  const h = harness();
  h.playback.playing = false;
  let renderer;
  const render = () => React.createElement(h.LyricsPanel, { song });
  await act(async () => {
    renderer = create(render());
  });
  const list = renderer.root.findByType("ScrollView");
  await act(() => {
    list.props.onLayout({ nativeEvent: { layout: { height: 80 } } });
    list.props.onContentSizeChange(300, 160);
    renderer.root
      .findAllByType("Pressable")
      .filter((node) => node.props.onLayout)
      .forEach((node, index) =>
        node.props.onLayout({ nativeEvent: { layout: { y: index * 40, height: 40 } } })
      );
  });
  h.playback.progress = 2.25;
  await act(() => renderer.update(render()));
  assert.deepEqual(h.nativeScrolls.at(-1), { x: 0, y: 60, animated: true });
  assert.equal(h.frames.size, 0, "scroll animations require no JS frame loop");
  await act(() => {
    list.props.onTouchStart();
    list.props.onScrollBeginDrag();
  });
  assert.equal(h.frames.size, 0);
  assert.equal(h.nativeScrolls.at(-1).animated, false, "drag stops the native glide");
  list.props.onScroll({ nativeEvent: { contentOffset: { y: 25 } } });
  const jump = renderer.root
    .findAllByType("Pressable")
    .find((node) =>
      node.findAllByType("Text").some((text) => text.props.children === "Jump to current line")
    );
  await act(() => jump.props.onPress());
  await act(() => h.advance(1000));
  assert.equal(h.scrolls.at(-1), 60);
  await act(() => renderer.unmount());
});

test("translation keeps synced originals, cancels stale languages, and can be turned off", async () => {
  const h = harness();
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(h.LyricsPanel, { song }));
  });
  const choose = async (label) => {
    await act(() =>
      renderer.root.findByProps({ accessibilityLabel: "Translate lyrics" }).props.onPress()
    );
    const option = renderer.root
      .findAllByType("Pressable")
      .find((node) => node.findAllByType("Text").some((text) => text.props.children === label));
    await act(() => option.props.onPress());
  };
  await choose("Hindi");
  assert.equal(h.translations.length, 1);
  assert.equal(h.translations[0].language, "hi");
  const translateButton = renderer.root.findByProps({ accessibilityLabel: "Translate lyrics" });
  assert.equal(
    translateButton.findByType("Text").props.children,
    "Translate",
    "the action remains labelled Translate after choosing a language"
  );
  await choose("Malayalam");
  assert.equal(h.translations[0].signal.aborted, true);
  await act(async () => h.translations[0].resolve(["stale", "stale", "stale", "stale"]));
  assert.equal(
    renderer.root.findAllByType("Text").some((t) => t.props.children === "stale"),
    false
  );
  await act(async () =>
    h.translations[1].resolve(["translated first", "translated second", "third", "fourth"])
  );
  assert.deepEqual(selectedText(renderer), ["First line"]);
  assert.equal(
    renderer.root.findAllByType("Text").some((t) => t.props.children === "translated first"),
    true
  );
  await act(() =>
    renderer.root.findByProps({ accessibilityLabel: "Second line, 0:01" }).props.onPress()
  );
  assert.deepEqual(h.seeks, [1], "translated lyrics seek using the original timestamp");
  await choose("Original only");
  assert.equal(
    renderer.root.findAllByType("Text").some((t) => t.props.children === "translated first"),
    false
  );
  await choose("Hindi");
  await act(async () => h.translations[2].reject(new Error("Service unavailable")));
  assert.equal(
    renderer.root.findAllByType("Text").some((t) => t.props.children === "First line"),
    true
  );
  await act(() =>
    renderer.root.findByProps({ accessibilityLabel: "Retry lyric translation" }).props.onPress()
  );
  assert.equal(h.translations.length, 4);
  await act(() =>
    renderer.update(React.createElement(h.LyricsPanel, { song: { ...song, id: "another" } }))
  );
  assert.equal(
    h.translations[3].signal.aborted,
    true,
    "song changes cancel in-flight translations"
  );
  await act(() => renderer.unmount());
  assert.equal(h.translations.at(-1).signal.aborted, true);
});

test("lyrics warmed at song selection render immediately when the panel opens", async () => {
  const h = harness();
  await h.lyricsCache.loadLyrics(song);
  let renderer;
  await act(() => {
    renderer = create(React.createElement(h.LyricsPanel, { song }));
  });
  assert.deepEqual(selectedText(renderer), ["First line"]);
  assert.equal(h.lyricRequests(), 1, "opening the panel reuses the prefetched result");
  assert.equal(
    renderer.root
      .findAllByType("Text")
      .some((node) => node.props.children === "Looking up the words"),
    false
  );
  await act(() => renderer.unmount());
});

test("lyrics prefetch and panel share one request, and failed lookups can be retried", async () => {
  let finish;
  let requests = 0;
  const cache = load("lib/lyrics-cache.ts", {
    "./lrclib": {
      lookupLyrics: () => {
        requests++;
        return new Promise((resolve, reject) => {
          finish = { resolve, reject };
        });
      },
    },
  });
  const prefetch = cache.loadLyrics(song);
  const panel = cache.loadLyrics(song);
  assert.equal(prefetch, panel);
  assert.equal(requests, 1);
  finish.reject(new Error("Unavailable"));
  assert.equal((await prefetch).kind, "error");
  assert.equal(cache.cachedLyrics(song.id), undefined);
  const retry = cache.loadLyrics(song);
  assert.equal(requests, 2);
  finish.resolve({ status: "found", result: { body: { kind: "plain", stanzas: ["Words"] } } });
  assert.equal((await retry).kind, "ready");
  assert.equal(cache.cachedLyrics(song.id).result.body.stanzas[0], "Words");
  assert.equal(await cache.loadLyrics(song), cache.cachedLyrics(song.id));
  assert.equal(requests, 2);
});

test("Karaoke sits beside Translate and leaves lyric timing and seeking intact", async () => {
  const h = harness();
  let renderer;
  const render = () => React.createElement(h.LyricsPanel, { song });
  await act(async () => {
    renderer = create(render());
  });
  const button = () => renderer.root.findByProps({ accessibilityLabel: "Karaoke mode" });
  const translator = renderer.root.findByProps({ accessibilityLabel: "Translate lyrics" });
  assert.equal(button().parent, translator.parent);
  await act(() => {
    button().props.onPress();
    renderer.update(render());
  });
  assert.deepEqual(h.karaokeChanges, [true]);
  assert.match(button().props.accessibilityHint, /current song without restarting/);
  assert.ok(
    renderer.root
      .findAllByType("Text")
      .some(
        (n) =>
          typeof n.props.children === "string" &&
          n.props.children.includes("Reducing vocals in the current song")
      )
  );
  assert.equal(h.seeks.length, 0, "Karaoke does not change lyric position");
  assert.equal(button().props.accessibilityState.selected, true);
  h.playback.karaokePreparing = true;
  h.playback.karaokeProgress = { stage: "saving", percent: 82 };
  await act(() => renderer.update(render()));
  assert.equal(
    renderer.root.findByProps({ accessibilityRole: "progressbar" }).props.accessibilityValue.now,
    82
  );
  assert.ok(
    button()
      .findAllByType("Text")
      .some((node) => node.props.children === "Preparing 82%")
  );
  h.playback.karaokePreparing = false;
  h.playback.progress = 1.25;
  await act(() => renderer.update(render()));
  await act(() => h.advance(10));
  assert.deepEqual(selectedText(renderer), ["Second line"]);
  await act(() =>
    renderer.root.findByProps({ accessibilityLabel: "Third line, 0:02" }).props.onPress()
  );
  assert.deepEqual(h.seeks, [2]);
  await act(() => {
    button().props.onPress();
    renderer.update(render());
  });
  assert.deepEqual(h.karaokeChanges, [true, false]);
  h.playback.karaokeAvailable = false;
  await act(() => renderer.update(render()));
  assert.equal(
    button().props.disabled,
    true,
    "unsupported players do not offer a fake karaoke effect"
  );
  await act(() => renderer.unmount());
});

test("lyrics return to the current line after manual scrolling and momentum finish", async () => {
  const h = harness();
  h.playback.playing = false;
  h.playback.progress = 2.25;
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(h.LyricsPanel, { song }));
  });
  const list = renderer.root.findByType("ScrollView");
  await act(() => {
    list.props.onLayout({ nativeEvent: { layout: { height: 80 } } });
    list.props.onContentSizeChange(300, 160);
    renderer.root
      .findAllByType("Pressable")
      .filter((node) => node.props.onLayout)
      .forEach((node, index) => {
        node.props.onLayout({ nativeEvent: { layout: { y: index * 40, height: 40 } } });
      });
    list.props.onTouchStart();
    list.props.onScrollBeginDrag();
    list.props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } });
  });
  assert.equal(h.timerCount(), 0, "a held finger must not start the return timer");
  await act(() => {
    list.props.onTouchEnd();
    list.props.onScrollEndDrag();
    list.props.onMomentumScrollBegin();
  });
  assert.equal(h.timerCount(), 0, "momentum cancels the pending return timer");
  await act(() => list.props.onMomentumScrollEnd());
  assert.equal(h.timerCount(), 1);
  await act(() => {
    h.advance(3000);
    h.runTimers();
  });
  assert.equal(h.scrolls.at(-1), 60, "return works even if the active line has not changed");
  assert.equal(
    renderer.root
      .findAllByType("Text")
      .some((node) => node.props.children === "Jump to current line"),
    false
  );
  await act(() => {
    list.props.onTouchStart();
    list.props.onScrollBeginDrag();
    list.props.onTouchCancel();
  });
  assert.equal(h.timerCount(), 1, "a cancelled gesture cannot leave following suspended forever");
  await act(() => {
    h.advance(3000);
    h.runTimers();
  });
  assert.equal(h.scrolls.at(-1), 60);
  await act(() => renderer.unmount());
  assert.equal(h.timerCount(), 0);
});
