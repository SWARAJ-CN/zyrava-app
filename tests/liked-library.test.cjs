/* global __dirname */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const React = require("react");
const { act, create } = require("react-test-renderer");
const ts = require("typescript");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
const noop = () => {};
const native = {
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  ScrollView: "ScrollView",
  Pressable: "Pressable",
  Image: "Image",
  ActivityIndicator: "ActivityIndicator",
};
const cn = (...values) => values.filter(Boolean).join(" ");
const song = (id) => ({
  id: String(id),
  title: `Song ${id}`,
  artist: "Artist",
  duration: 180,
  streamUrl: `https://example.test/${id}.mp3`,
});

function libraryHarness() {
  const auth = { user: { id: "first" } };
  const storage = new Map([
    ["zyrava-library:first", JSON.stringify({ liked: [song(1), song(2)], playlists: [] })],
    ["zyrava-library:second", JSON.stringify({ liked: [song(3)], playlists: [] })],
  ]);
  const requests = [];
  const library = load("components/providers/LibraryProvider.tsx", {
    "react-native": native,
    "@/lib/store": {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
    "@/lib/uuid": { randomUUID: () => "test" },
    "@/components/ui/icons": { Icon: "Icon" },
    "@/components/ui/Button": { Button: "Button" },
    "@/components/ui/Modal": { Modal: "Modal" },
    "@/components/providers/AuthProvider": { useAuth: () => auth },
    "@/components/providers/GuestLockProvider": {
      useGuestLock: () => ({ requireAuth: () => true }),
    },
    "@/components/providers/MusicPlayerProvider": { useMusicPlayer: () => ({ startQueue: noop }) },
    "@/components/providers/TasteProvider": { useTaste: () => ({ record: noop }) },
    "@/components/providers/ToastProvider": { useToast: () => ({ success: noop, toast: noop }) },
    "@/lib/cn": { cn },
    "@/lib/socket": { onCommunityEvent: () => noop, onCommunityStatus: () => noop },
    "@/lib/library": {
      fetchLibrary: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
      dropLike: async () => {},
      saveLikes: async () => {},
    },
  });
  let latest;
  const paints = [];
  function Consumer() {
    latest = library.useLibrary();
    paints.push(latest.liked.map((item) => item.id));
    return null;
  }
  return {
    ...library,
    auth,
    storage,
    requests,
    paints,
    Consumer,
    get current() {
      return latest;
    },
  };
}

test("cached likes appear on the first paint before a slow server answers", async () => {
  const h = libraryHarness();
  let renderer;
  await act(() => {
    renderer = create(
      React.createElement(h.LibraryProvider, null, React.createElement(h.Consumer))
    );
  });
  assert.deepEqual(h.paints[0], ["1", "2"]);
  assert.equal(h.current.loading, true);
  assert.equal(h.requests.length, 1);
  await act(async () => {
    h.requests[0].resolve({ liked: [song(4)], playlists: [] });
  });
  assert.deepEqual(
    h.current.liked.map((item) => item.id),
    ["4"]
  );
  assert.equal(h.current.loading, false);
  await act(() => renderer.unmount());
});

test("a late refresh cannot undo an unlike made from the cached list", async () => {
  const h = libraryHarness();
  let renderer;
  await act(() => {
    renderer = create(
      React.createElement(h.LibraryProvider, null, React.createElement(h.Consumer))
    );
  });
  await act(() => h.current.toggleLike(song(1)));
  assert.deepEqual(
    h.current.liked.map((item) => item.id),
    ["2"]
  );
  await act(async () => {
    h.requests[0].resolve({ liked: [song(1), song(2)], playlists: [] });
  });
  assert.deepEqual(
    h.current.liked.map((item) => item.id),
    ["2"]
  );
  assert.deepEqual(
    JSON.parse(h.storage.get("zyrava-library:first")).liked.map((item) => item.id),
    ["2"]
  );
  await act(() => renderer.unmount());
});

test("switching accounts shows only the new cache and ignores the previous response", async () => {
  const h = libraryHarness();
  let renderer;
  const tree = () => React.createElement(h.LibraryProvider, null, React.createElement(h.Consumer));
  await act(() => {
    renderer = create(tree());
  });
  h.auth.user = { id: "second" };
  const beforeSwitch = h.paints.length;
  await act(() => renderer.update(tree()));
  assert.ok(h.paints.slice(beforeSwitch).every((ids) => ids.join() === "3"));
  await act(async () => {
    h.requests[0].resolve({ liked: [song(99)], playlists: [] });
  });
  assert.deepEqual(
    h.current.liked.map((item) => item.id),
    ["3"]
  );
  await act(async () => {
    h.requests[1].reject(new Error("offline"));
  });
  assert.deepEqual(
    h.current.liked.map((item) => item.id),
    ["3"]
  );
  assert.deepEqual(
    JSON.parse(h.storage.get("zyrava-library:second")).liked.map((item) => item.id),
    ["3"]
  );
  await act(() => renderer.unmount());
});

const offline = {
  savedIds: new Set(),
  progress: {},
  saving: null,
  saveAll: noop,
  exportCopy: noop,
};
test("a large liked collection has a bounded first render and passes the full queue to later rows", async () => {
  const liked = Array.from({ length: 1000 }, (_, index) => song(index));
  function FlatList(props) {
    return React.createElement(
      "FlatList",
      props,
      props.ListHeaderComponent,
      ...props.data
        .slice(0, props.initialNumToRender)
        .map((item, index) =>
          React.createElement(React.Fragment, { key: item.id }, props.renderItem({ item, index }))
        )
    );
  }
  const { LikedView } = load("components/features/music/LikedView.tsx", {
    "react-native": { ...native, FlatList },
    "@/components/ui/icons": { Icon: "Icon" },
    "@/components/features/music/CollectionHero": {
      CollectionHero: "Hero",
      OutlineAction: "Action",
      RoundPlay: "Play",
    },
    "@/components/features/music/SongRows": { SongRow: "SongRow", SongTableHead: "Head" },
    "@/components/providers/LibraryProvider": { useLibrary: () => ({ liked, loading: false }) },
    "@/components/providers/MusicPlayerProvider": { useMusicPlayer: () => ({ startQueue: noop }) },
    "@/components/providers/OfflineProvider": { useOffline: () => offline },
    "@/components/providers/ToastProvider": { useToast: () => ({ toast: noop }) },
    "@/lib/cn": { cn },
    "@/lib/format": { formatRuntime: String },
  });
  let renderer;
  await act(() => {
    renderer = create(React.createElement(LikedView));
  });
  assert.equal(renderer.root.findAllByType("SongRow").length, 8);
  const list = renderer.root.findByType("FlatList");
  assert.equal(list.props.data.length, 1000);
  const later = list.props.renderItem({ item: liked[700], index: 700 });
  assert.equal(later.props.children.props.songs, liked);
  assert.equal(later.props.children.props.index, 700);
  assert.equal(later.props.children.props.song, liked[700]);
  await act(() => renderer.unmount());
});

test("playing a virtualized row starts the complete collection at its absolute index", async () => {
  const liked = Array.from({ length: 40 }, (_, index) => song(index));
  const plays = [];
  const { SongRow } = load("components/features/music/SongRows.tsx", {
    "react-native": native,
    "react-native-svg": { __esModule: true, default: "Svg", Circle: "Circle" },
    uniwind: { useCSSVariable: () => "#fff" },
    "@/components/ui/icons": { Icon: "Icon" },
    "@/components/providers/LibraryProvider": {
      useLibrary: () => ({ isLiked: () => true, toggleLike: noop, openPicker: noop }),
    },
    "@/components/providers/MusicPlayerProvider": {
      useMusicPlayer: () => ({ startQueue: (...args) => plays.push(args) }),
    },
    "@/components/providers/GuestLockProvider": {
      useGuestLock: () => ({ requireAuth: () => true }),
    },
    "@/components/providers/OfflineProvider": { useOffline: () => offline },
    "@/components/features/music/Waveform": { Waveform: "Waveform" },
    "@/components/features/music/EqBars": { EqBars: "EqBars" },
    "@/lib/cn": { cn },
  });
  let renderer;
  await act(() => {
    renderer = create(
      React.createElement(SongRow, {
        song: liked[35],
        index: 35,
        songs: liked,
        label: "Liked songs",
        table: true,
      })
    );
  });
  await act(() =>
    renderer.root.findByProps({ accessibilityLabel: "Play Song 35 by Artist" }).props.onPress()
  );
  assert.deepEqual(plays, [[liked, "Liked songs", 35]]);
  await act(() => renderer.unmount());
});
