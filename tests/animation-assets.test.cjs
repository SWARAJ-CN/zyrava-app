/* global __dirname */
const { test } = require("node:test");
const { Buffer } = require("node:buffer");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { act, create } = require("react-test-renderer");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function load(file, mocks = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(readFileSync(path.join(__dirname, "../src", file), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("module", "exports", "require", js)(module, module.exports, (name) =>
    Object.hasOwn(mocks, name) ? mocks[name] : require(name)
  );
  return module.exports;
}
const validation = load("lib/animation-source.ts");
const folder = path.join(__dirname, "../assets/animations/customization");

test("every bundled customization animation is self-contained for Android rendering", () => {
  for (const filename of readdirSync(folder).filter((name) => name.endsWith(".json"))) {
    const source = JSON.parse(readFileSync(path.join(folder, filename), "utf8"));
    assert.equal(validation.isSelfContainedAnimation(source), true, filename);
    const assets = new Map((source.assets ?? []).map((asset) => [asset.id, asset]));
    const layers = [
      ...source.layers,
      ...(source.assets ?? []).flatMap((asset) => asset.layers ?? []),
    ];
    for (const layer of layers.filter((layer) => layer.ty === 2)) {
      const asset = assets.get(layer.refId);
      assert.ok(
        asset?.p.startsWith("data:image/"),
        `${filename}: unresolved raster ${layer.refId}`
      );
      assert.ok(Buffer.from(asset.p.split(",")[1], "base64").length > 0);
    }
  }
});

test("default Couples 2 preview includes the original PNG, not an archive-relative filename", () => {
  const animation = JSON.parse(
    readFileSync(path.join(folder, "custom-couples-2-a74f1184.json"), "utf8")
  );
  const asset = animation.assets.find((item) => item.id === "image_0");
  const bytes = Buffer.from(asset.p.split(",")[1], "base64");
  assert.equal(bytes.length, 8902);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), asset.w);
  assert.equal(bytes.readUInt32BE(20), asset.h);
  assert.equal(asset.u, "");
  const broken = { ...animation, assets: [{ ...asset, e: 1, p: "image_0.png" }] };
  assert.equal(
    validation.isSelfContainedAnimation(broken),
    false,
    "e=1 alone never means the bytes are embedded"
  );
});

test("preview rejects unresolved images before mounting native Lottie and handles parse failure", async () => {
  const unsafe = { layers: [], assets: [{ id: "image", p: "image.png", e: 1 }] };
  const safe = { layers: [], assets: [] };
  const { Animation } = load("components/ui/Animation.tsx", {
    "react-native": {
      View: "View",
      Text: "Text",
      AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
    },
    "lottie-react-native": { __esModule: true, default: "LottieView" },
    "@/lib/animation-assets": {
      ANIMATION_ASSETS: { unsafe: () => unsafe, safe: () => safe, another: () => safe },
    },
    "@/lib/animation-source": validation,
    "@/hooks/useReduceMotion": { useReduceMotion: () => false },
  });
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(Animation, { id: "unsafe" }));
  });
  assert.equal(renderer.root.findAllByType("LottieView").length, 0);
  assert.equal(renderer.root.findByType("Text").children[0], "Animation preview unavailable");
  await act(async () => renderer.update(React.createElement(Animation, { id: "safe" })));
  assert.equal(renderer.root.findAllByType("LottieView").length, 1);
  await act(async () =>
    renderer.root.findByType("LottieView").props.onAnimationFailure("decode failed")
  );
  assert.equal(renderer.root.findAllByType("LottieView").length, 0);
  await act(async () => renderer.update(React.createElement(Animation, { id: "another" })));
  assert.equal(renderer.root.findAllByType("LottieView").length, 1);
  await act(async () => renderer.update(React.createElement(Animation, { id: "unknown" })));
  assert.equal(renderer.root.findAllByType("LottieView").length, 0);
  await act(async () => renderer.update(React.createElement(Animation, { id: "none" })));
  assert.equal(renderer.toJSON(), null);
  await act(async () => renderer.unmount());
});

test("playback, source replacement and Activity cleanup never command a detached Lottie view", async () => {
  let foregroundChanged;
  let reduced = false;
  let loads = 0;
  const commands = [];
  const safe = { layers: [], assets: [] };
  class NativePlayer extends React.PureComponent {
    attached = true;
    pause() {
      commands.push("pause");
      if (!this.attached) throw new Error("Cannot dispatch pause to detached native view");
    }
    resume() {
      commands.push("resume");
    }
    play() {
      commands.push("play");
    }
    componentWillUnmount() {
      this.attached = false;
    }
    render() {
      return React.createElement("LottieView", this.props);
    }
  }
  const { Animation } = load("components/ui/Animation.tsx", {
    "react-native": {
      View: "View",
      Text: "Text",
      AppState: {
        currentState: "active",
        addEventListener: (_event, listener) => {
          foregroundChanged = listener;
          return { remove() {} };
        },
      },
    },
    "lottie-react-native": { __esModule: true, default: NativePlayer },
    "@/lib/animation-assets": {
      ANIMATION_ASSETS: {
        first: () => {
          loads++;
          return safe;
        },
        second: () => {
          loads++;
          return safe;
        },
      },
    },
    "@/lib/animation-source": validation,
    "@/hooks/useReduceMotion": { useReduceMotion: () => reduced },
  });
  let renderer;
  const element = (id = "first", playing = true, mode = "visible") =>
    React.createElement(React.Activity, { mode }, React.createElement(Animation, { id, playing }));
  await act(async () => {
    renderer = create(element());
  });
  assert.equal(renderer.root.findByType("LottieView").props.speed, 1);
  await act(async () => renderer.update(element("first", false)));
  assert.equal(renderer.root.findByType("LottieView").props.speed, 0);
  await act(async () => renderer.update(element()));
  await act(async () => foregroundChanged("background"));
  assert.equal(renderer.root.findByType("LottieView").props.speed, 0);
  await act(async () => foregroundChanged("active"));
  assert.equal(renderer.root.findByType("LottieView").props.speed, 1);
  assert.equal(loads, 1, "ordinary playback changes do not reload or revalidate JSON");
  await act(async () => renderer.update(element("second")));
  assert.equal(loads, 2);
  await act(async () => renderer.update(element("second", true, "hidden")));
  await act(async () => renderer.update(element("second")));
  reduced = true;
  await act(async () => renderer.update(element("second", false)));
  assert.equal(renderer.root.findByType("LottieView").props.autoPlay, false);
  assert.equal(renderer.root.findByType("LottieView").props.progress, 0.33);
  await act(async () => renderer.unmount());
  assert.deepEqual(
    commands,
    [],
    "no play/pause/resume commands may run during cleanup or replacement"
  );
});
