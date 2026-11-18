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

function harness() {
  const files = new Map([["file:///picked/song.mp3", 1234]]);
  const settings = new Map();
  let result = { canceled: false, assets: [{ uri: "file:///picked/song.mp3", name: "Song.mp3" }] };
  let failCopy = false;
  class Directory {
    constructor(...parts) {
      this.uri = parts.join("/");
    }
    create() {}
  }
  class File {
    constructor(parent, child) {
      this.uri = child ? `${parent.uri}/${child}` : parent;
    }
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return files.get(this.uri) ?? 0;
    }
    async copy(target) {
      files.set(target.uri, this.size);
      if (failCopy) throw new Error("storage full");
    }
    delete() {
      files.delete(this.uri);
    }
  }
  const api = load("lib/instrumentals.ts", {
    "expo-document-picker": { getDocumentAsync: async () => result },
    "expo-file-system": { Directory, File, Paths: { document: "file:///documents" } },
    "./store": {
      getItem: (key) => settings.get(key) ?? null,
      setItem: (key, value) => settings.set(key, value),
    },
  });
  return {
    api,
    files,
    settings,
    setResult: (value) => {
      result = value;
    },
    fail: () => {
      failCopy = true;
    },
  };
}
test("selected instrumental is copied and remembered only for its song", async () => {
  const h = harness();
  const first = await h.api.pickInstrumental("song-a");
  assert.ok(first.uri.startsWith("file:///documents/zyrava-instrumentals/"));
  assert.deepEqual(h.api.getInstrumental("song-a"), first);
  assert.equal(h.api.getInstrumental("song-b"), null);
  const second = await h.api.pickInstrumental("song-a");
  assert.notEqual(first.uri, second.uri);
  assert.equal(h.files.has(first.uri), false);
  assert.ok(h.files.has("file:///picked/song.mp3"), "never delete the user's original file");
  h.files.delete(second.uri);
  assert.equal(h.api.getInstrumental("song-a"), null, "missing files prompt a new choice");
});
test("cancel, invalid files and failed copies preserve the previous instrumental", async () => {
  const h = harness();
  const first = await h.api.pickInstrumental("song-a");
  h.setResult({ canceled: true });
  assert.equal(await h.api.pickInstrumental("song-a"), null);
  h.setResult({
    canceled: false,
    assets: [{ uri: "file:///picked/song.mp3", name: "not-audio.exe" }],
  });
  await assert.rejects(h.api.pickInstrumental("song-a"), /Choose an MP3/);
  h.setResult({ canceled: false, assets: [{ uri: "file:///picked/song.mp3", name: "Song.mp3" }] });
  h.fail();
  await assert.rejects(h.api.pickInstrumental("song-a"), /storage full/);
  assert.deepEqual(h.api.getInstrumental("song-a"), first);
  assert.equal(h.files.size, 2, "partial copies are removed");
});
test("oversized files and invalid saved metadata are rejected", async () => {
  const h = harness();
  h.files.set("file:///picked/song.mp3", 101 * 1024 * 1024);
  await assert.rejects(h.api.pickInstrumental("song-a"), /100 MB/);
  h.settings.set(
    "zyrava.instrumental.song-a",
    JSON.stringify({ uri: "file:///picked/song.mp3", name: "Song" })
  );
  assert.equal(h.api.getInstrumental("song-a"), null);
});
