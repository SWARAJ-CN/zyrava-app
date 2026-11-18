/* global __dirname */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const compiled = ts.transpileModule(
  readFileSync(path.resolve(__dirname, "../src/lib/karaoke.ts"), "utf8"),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }
).outputText;
const loaded = { exports: {} };
new Function("module", "exports", compiled)(loaded, loaded.exports);
const { createKaraokeStage } = loaded.exports;

function graph(fail = false) {
  const nodes = [];
  const param = (value) => ({
    value,
    setTargetAtTime(next) {
      this.value = next;
    },
  });
  const node = (kind) => {
    const result = {
      kind,
      edges: [],
      gain: param(1),
      frequency: param(0),
      Q: param(0),
      connect(target, output = 0, input = 0) {
        this.edges.push({ target, output, input });
      },
      disconnect() {
        this.edges = [];
      },
    };
    nodes.push(result);
    return result;
  };
  const context = {
    currentTime: 0,
    createGain: () => node("gain"),
    createBiquadFilter: () => node("filter"),
    createChannelSplitter: () => node("splitter"),
    createChannelMerger: () => {
      if (fail) throw new Error("unsupported");
      return node("merger");
    },
  };
  // Evaluate the actual connected graph at the low-pass filter's limiting
  // responses: unity for DC bass, zero far above its cutoff.
  function output(stage, stereoInput, bassPasses) {
    const evaluate = (current) => {
      if (current === stage.input) return stereoInput;
      const incoming = nodes.flatMap((source) =>
        source.edges
          .filter((edge) => edge.target === current)
          .map((edge) => {
            const signal = evaluate(source);
            return {
              input: edge.input,
              signal: source.kind === "splitter" ? [signal[edge.output] ?? 0] : signal,
            };
          })
      );
      if (current.kind === "merger")
        return [0, 1].map((port) =>
          incoming
            .filter((edge) => edge.input === port)
            .reduce((sum, edge) => sum + edge.signal[0], 0)
        );
      const count = Math.max(1, ...incoming.map((edge) => edge.signal.length));
      const sum = Array.from({ length: count }, (_, channel) =>
        incoming.reduce(
          (total, edge) =>
            total + (edge.signal.length === 1 ? edge.signal[0] : (edge.signal[channel] ?? 0)),
          0
        )
      );
      const gain =
        current.kind === "filter"
          ? bassPasses
            ? 1
            : 0
          : current.kind === "gain"
            ? current.gain.value
            : 1;
      return sum.map((sample) => sample * gain);
    };
    return evaluate(stage.output);
  }
  return { context, nodes, output };
}

const near = (actual, expected) =>
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9));

test("karaoke reduces centered material, preserves stereo difference and restores centered bass", () => {
  const h = graph();
  const stage = createKaraokeStage(h.context);
  near(h.output(stage, [0.7, -0.2], false), [0.7, -0.2]);
  stage.setEnabled(true);
  near(h.output(stage, [1, 1], false), [0.1, 0.1]);
  near(h.output(stage, [1, -1], false), [1, -1]);
  near(h.output(stage, [1, 1], true), [1, 1]);
  stage.setEnabled(false);
  near(h.output(stage, [0.2, 0.8], false), [0.2, 0.8]);
  stage.dispose();
  assert.ok(h.nodes.every((node) => node.edges.length === 0));
});

test("failed karaoke construction releases partial nodes", () => {
  const h = graph(true);
  assert.throws(() => createKaraokeStage(h.context), /unsupported/);
  assert.ok(h.nodes.every((node) => node.edges.length === 0));
});

// Exercise the exact static code embedded in the Expo Go effects player as well.
test("Expo Go live karaoke has the same signal routing as the native stage", () => {
  const create = new Function(
    loaded.exports.liveKaraokeScript() + ";return createLiveKaraokeStage;"
  )();
  const h = graph();
  const stage = create(h.context);
  near(h.output(stage, [0.7, -0.2], false), [0.7, -0.2]);
  stage.setEnabled(true);
  near(h.output(stage, [1, 1], false), [0.1, 0.1]);
  near(h.output(stage, [1, -1], false), [1, -1]);
  near(h.output(stage, [1, 1], true), [1, 1]);
  stage.setEnabled(false);
  near(h.output(stage, [0.2, 0.8], false), [0.2, 0.8]);
});
