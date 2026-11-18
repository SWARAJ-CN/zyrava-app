/* global __dirname */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

function load(fetch) {
  const module = { exports: {} };
  const code = ts.transpileModule(
    readFileSync(path.resolve(__dirname, "../src/lib/lyric-translation.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  new Function("module", "exports", "fetch", code)(module, module.exports, fetch);
  return module.exports.translateLyricLines;
}

test("translations preserve row order, blank lines and repeats, with language-specific caching", async () => {
  const calls = [];
  let running = 0;
  let peak = 0;
  const translate = load(async (url) => {
    const params = new URL(url).searchParams;
    calls.push(params);
    peak = Math.max(peak, ++running);
    await new Promise((resolve) => setImmediate(resolve));
    running--;
    const text = params
      .get("q")
      .split("\n")
      .map((line) => `${params.get("tl")}:${line}`)
      .join("\n");
    return { ok: true, json: async () => [[[text]]] };
  });
  const signal = new AbortController().signal;
  const lines = [
    "First",
    "",
    "Second",
    "First",
    ...Array.from({ length: 25 }, (_, i) => `Line ${i}`),
  ];
  const result = await translate(lines, "hi", signal);
  assert.deepEqual(
    result,
    lines.map((line) => (line ? `hi:${line}` : ""))
  );
  assert.equal(peak, 2);
  assert.ok(calls.every((params) => params.get("sl") === "auto"));
  const count = calls.length;
  await translate(lines, "hi", signal);
  assert.equal(calls.length, count, "reopening the same translation needs no network request");
  assert.deepEqual(await translate(["First"], "ml", signal), ["ml:First"]);
  assert.equal(calls.length, count + 1);
});

test("merged batch lines are retried separately without shifting timestamps", async () => {
  const calls = [];
  const translate = load(async (url) => {
    const text = new URL(url).searchParams.get("q");
    calls.push(text);
    return {
      ok: true,
      json: async () => [[[text.includes("\n") ? "One merged line" : `Translated ${text}`]]],
    };
  });
  assert.deepEqual(await translate(["First", "Second"], "hi", new AbortController().signal), [
    "Translated First",
    "Translated Second",
  ]);
  assert.deepEqual(calls, ["First\nSecond", "First", "Second"]);
});

test("blocked and invalid responses show actionable errors and are not cached", async () => {
  let bad = true;
  const translate = load(async () => ({ ok: !bad, status: 429, json: async () => [[["One"]]] }));
  const signal = new AbortController().signal;
  await assert.rejects(translate(["First"], "hi", signal), /busy/);
  bad = false;
  assert.deepEqual(await translate(["First"], "hi", signal), ["One"]);
  const blocked = load(async () => ({ ok: false }));
  await assert.rejects(blocked(["First"], "hi", signal), /unavailable/);
  const html = load(async () => ({
    ok: true,
    json: async () => {
      throw new SyntaxError("HTML response");
    },
  }));
  await assert.rejects(html(["First"], "hi", signal), /invalid response/);
});

function memoryResponse(text, translated = `Fallback ${text}`) {
  return {
    ok: true,
    json: async () => ({
      responseStatus: 200,
      quotaFinished: false,
      responseData: { translatedText: translated },
      matches: [{ id: 0, segment: text, translation: translated }],
    }),
  };
}

test("Google throttling falls back using song language and caches successful lines", async () => {
  const urls = [];
  const translate = load(async (url) => {
    urls.push(new URL(url));
    if (url.includes("googleapis")) return { ok: false, status: 429 };
    return memoryResponse(new URL(url).searchParams.get("q"));
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await translate(["First", "", "Second", "First"], "ml", signal, "English"), [
    "Fallback First",
    "",
    "Fallback Second",
    "Fallback First",
  ]);
  assert.deepEqual(
    urls
      .filter((url) => url.hostname.startsWith("api.mymemory"))
      .map((url) => url.searchParams.get("langpair")),
    ["en|ml", "en|ml"]
  );
  await translate(["First"], "ml", signal, "english");
  assert.equal(urls.length, 3);
  await translate(["Third"], "ml", signal, "english");
  assert.equal(
    urls.filter((url) => url.hostname.includes("googleapis")).length,
    1,
    "429 cooldown avoids repeatedly hitting Google"
  );
});

test("fallback refuses quota errors and fuzzy matches instead of showing the wrong lyric", async () => {
  for (const [payload, error] of [
    [
      {
        responseStatus: 200,
        quotaFinished: true,
        responseData: { translatedText: "LIMIT REACHED" },
      },
      /limit/,
    ],
    [
      {
        responseStatus: 200,
        responseData: { translatedText: "Different sentence" },
        matches: [{ segment: "Different source", translation: "Different sentence" }],
      },
      /matching translation/,
    ],
    [
      { responseStatus: 403, responseData: { translatedText: "INVALID LANGUAGE PAIR" } },
      /language pair/,
    ],
  ]) {
    const translate = load(async (url) =>
      url.includes("googleapis")
        ? { ok: false, status: 429 }
        : { ok: true, json: async () => payload }
    );
    await assert.rejects(
      translate(["First"], "ml", new AbortController().signal, "english"),
      error
    );
  }
});

test("fallback respects UTF-8 request limits and aborts when switching songs", async () => {
  const requests = [];
  const translate = load(async (url) => {
    if (url.includes("googleapis")) return { ok: false, status: 429 };
    const text = new URL(url).searchParams.get("q");
    requests.push(text);
    return memoryResponse(text);
  });
  await translate(["മലയാളം ".repeat(70)], "en", new AbortController().signal, "malayalam");
  assert.ok(requests.length > 1);
  assert.ok(requests.every((text) => new TextEncoder().encode(text).length <= 500));

  const controller = new AbortController();
  let started;
  const running = new Promise((resolve) => {
    started = resolve;
  });
  let fallbackCalls = 0;
  const cancellable = load((url, { signal }) => {
    if (url.includes("googleapis")) return Promise.resolve({ ok: false, status: 429 });
    fallbackCalls++;
    started();
    return new Promise((resolve, reject) =>
      signal.addEventListener("abort", () => reject(new Error("aborted")))
    );
  });
  const pending = cancellable(["First", "Second"], "ml", controller.signal, "english");
  await running;
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(fallbackCalls, 1);
});

test("abort stops in-flight requests and prevents launching more batches", async () => {
  const controller = new AbortController();
  let calls = 0;
  const translate = load(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        calls++;
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })
  );
  const pending = translate(
    Array.from({ length: 40 }, (_, i) => `Line ${i}`),
    "hi",
    controller.signal
  );
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(calls, 2);
  await assert.rejects(translate(["Never sent"], "hi", controller.signal), /cancelled/);
  assert.equal(calls, 2);
});
