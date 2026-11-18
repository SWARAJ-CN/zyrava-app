/* global __dirname */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const { transformSync } = require("@babel/core");
const {
  expoInlineEnvVars,
} = require("../node_modules/babel-preset-expo/build/plugins/inline-env-vars");

const lib = path.resolve(__dirname, "../src/lib");
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });

// Exercise the actual TS modules without loading React Native's native runtime.
function runtime({ mocks = {}, fetch, processEnv = {}, transform } = {}) {
  const modules = new Map();
  const compile = (source) =>
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
  function load(filename) {
    filename = path.resolve(lib, filename);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const code = compile(readFileSync(filename, "utf8"));
    const localRequire = (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), `${name}.ts`));
      return require(name);
    };
    const timer = (...args) => {
      const handle = setTimeout(...args);
      handle.unref();
      return handle;
    };
    new Function(
      "module",
      "exports",
      "require",
      "fetch",
      "process",
      "setTimeout",
      transform ? transform(code) : code
    )(module, module.exports, localRequire, fetch, { env: processEnv }, timer);
    return module.exports;
  }
  return load;
}

test("Expo release transform embeds all configured server URLs with no runtime env", () => {
  const values = {
    EXPO_PUBLIC_API_URL: " https://account.example/ ",
    EXPO_PUBLIC_MUSIC_API: "https://catalogue.example/api/, https://backup.example/api",
    EXPO_PUBLIC_WEB_BASE_URL: " https://web.example/ ",
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    const load = runtime({
      mocks: { "expo-constants": { expoConfig: { extra: {} } } },
      transform: (code) =>
        transformSync(code, {
          configFile: false,
          babelrc: false,
          caller: { name: "metro", isDev: false, platform: "android" },
          plugins: [expoInlineEnvVars],
        }).code,
    });
    const env = load("env.ts");
    assert.equal(env.API_URL, "https://account.example");
    assert.equal(env.WEB_BASE_URL, "https://web.example");
    assert.deepEqual(env.MUSIC_API_BASES, [
      "https://catalogue.example/api",
      "https://backup.example/api",
    ]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Expo extra remains a fallback and an empty mirror list enables direct-only mode", () => {
  const load = runtime({
    mocks: {
      "expo-constants": {
        expoConfig: {
          extra: { EXPO_PUBLIC_API_URL: "https://extra.example/", EXPO_PUBLIC_MUSIC_API: "" },
        },
      },
    },
  });
  assert.equal(load("env.ts").API_URL, "https://extra.example");
  assert.deepEqual(load("env.ts").MUSIC_API_BASES, []);
});

test("native login, expired bearer refresh, cookie rotation and logout match the account API", async () => {
  const storage = new Map();
  const calls = [];
  const session = (token) => ({ user: { id: "member" }, accessToken: token });
  const responses = [
    json({ csrfToken: "csrf-value" }, 200, { "set-cookie": "zyrava_csrf=csrf-value; Path=/" }),
    json(session("old-access"), 200, {
      "set-cookie": "zyrava_refresh=first; Path=/api/auth; HttpOnly",
    }),
    json({ error: "Expired" }, 401),
    json(session("new-access"), 200, {
      "set-cookie": "zyrava_refresh=rotated; Path=/api/auth; HttpOnly",
    }),
    json({ liked: [], playlists: [] }),
    new Response(null, {
      status: 204,
      headers: {
        "set-cookie": "zyrava_refresh=; Path=/api/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      },
    }),
    json({ csrfToken: "csrf-value" }),
  ];
  const load = runtime({
    mocks: {
      "./env": { API_URL: "https://account.example" },
      "./store": {
        getItem: (key) => storage.get(key),
        setItem: (key, value) => storage.set(key, value),
      },
    },
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      return responses.shift();
    },
  });
  const api = load("api.ts");
  await api.loginRequest({
    identifier: "member@example.com",
    password: "test-only",
    remember: true,
  });
  assert.equal(calls[1].headers.get("X-CSRF-Token"), "csrf-value");
  assert.match(calls[1].headers.get("Cookie"), /zyrava_csrf=csrf-value/);
  await api.apiFetch("/api/library");
  assert.equal(calls[3].url, "https://account.example/api/auth/refresh");
  assert.match(calls[3].headers.get("Cookie"), /zyrava_refresh=first/);
  assert.equal(calls[4].headers.get("Authorization"), "Bearer new-access");
  assert.equal(api.getAccessToken(), "new-access");
  await api.logoutRequest();
  assert.match(calls[5].headers.get("Cookie"), /zyrava_refresh=rotated/);
  assert.equal(api.getAccessToken(), null);
  await load("net.ts").netFetch("/api/auth/csrf");
  assert.doesNotMatch(calls[6].headers.get("Cookie"), /zyrava_refresh/);
  assert.equal(responses.length, 0);
});

test("CSRF bootstrap failures use ApiError and stale CSRF retries only once", async () => {
  const offline = runtime({
    mocks: {
      "./net": {
        netFetch: async () => {
          throw new TypeError("Network request failed");
        },
      },
    },
  })("api.ts");
  await assert.rejects(
    offline.loginRequest({}),
    (error) => error instanceof offline.ApiError && /account server/.test(error.message)
  );
  const paths = [];
  const responses = [
    json({ csrfToken: "old" }),
    json({ error: "Bad CSRF" }, 403),
    json({ csrfToken: "new" }),
    json({ error: "Bad CSRF" }, 403),
  ];
  const api = runtime({
    mocks: {
      "./net": {
        netFetch: async (url) => {
          paths.push(url);
          return responses.shift();
        },
      },
    },
  })("api.ts");
  await assert.rejects(api.loginRequest({}), (error) => error.status === 403);
  assert.deepEqual(paths, [
    "/api/auth/csrf",
    "/api/auth/login",
    "/api/auth/csrf",
    "/api/auth/login",
  ]);
});

test("hosted music calls use the web routes and their response envelopes", async () => {
  const calls = [];
  const load = runtime({
    mocks: {
      "./env": { WEB_BASE_URL: "https://web.example", MUSIC_API_BASES: ["https://unused.example"] },
    },
    fetch: async (url, init) => {
      calls.push({ url: new URL(url), init });
      if (url.includes("/playlists/")) return json({ playlist: { id: "mix", songs: [] } });
      if (url.includes("/playlists?")) return json({ playlists: [{ id: "mix" }], total: 1 });
      return json({ songs: [{ id: "server-result" }], total: 42 });
    },
  });
  const music = load("saavn.ts");
  assert.equal((await music.searchSongs(" Tamil & hits ", 999, 0)).songs[0].id, "server-result");
  assert.equal(calls[0].url.pathname, "/api/music/search");
  assert.equal(calls[0].url.searchParams.get("q"), "Tamil & hits");
  assert.equal(calls[0].url.searchParams.get("limit"), "30");
  assert.equal(calls[0].url.searchParams.get("page"), "1");
  assert.equal((await music.searchPlaylists("mix", 99)).total, 1);
  assert.equal(calls[1].url.searchParams.get("limit"), "16");
  assert.equal((await music.getPlaylistDetail("mix")).id, "mix");
  assert.equal(calls[2].url.pathname, "/api/music/playlists/mix");
  assert.ok(calls.every(({ init }) => init.credentials === "omit" && !init.headers.Authorization));
});

test("direct music searches match web limits, over-fetching and duplicate removal", async () => {
  let requested;
  const track = (id, name) => ({
    id,
    name,
    primaryArtists: "Artist",
    duration: 100,
    downloadUrl: [{ quality: "320kbps", url: "https://cdn.example/song.mp4" }],
  });
  const load = runtime({
    mocks: { "./env": { WEB_BASE_URL: "", MUSIC_API_BASES: ["https://catalogue.example/api"] } },
    fetch: async (url) => {
      requested = new URL(url);
      return json({
        data: {
          results: [
            track("1", "First"),
            track("2", "First"),
            track("3", "Second"),
            track("4", "Third"),
          ],
          total: 100,
        },
      });
    },
  });
  const music = load("saavn.ts");
  const result = await music.searchSongs(" hits ", 2, 4);
  assert.equal(requested.searchParams.get("limit"), "4");
  assert.equal(requested.searchParams.get("query"), "hits");
  assert.equal(requested.searchParams.get("page"), "4");
  assert.deepEqual(
    result.songs.map((song) => song.id),
    ["1", "3"]
  );
  assert.equal(result.total, 100);
  await assert.rejects(music.searchSongs(" "), (error) => error.status === 400);
});

test("a hosted outage stays an error; playlist 404 stays a missing playlist", async () => {
  let calls = 0;
  const load = runtime({
    mocks: {
      "./env": { WEB_BASE_URL: "https://web.example", MUSIC_API_BASES: ["https://unused.example"] },
    },
    fetch: async (url) => {
      calls++;
      return json({ error: "Unavailable" }, url.includes("/playlists/") ? 404 : 503);
    },
  });
  await assert.rejects(load("saavn.ts").searchSongs("hits"), (error) => error.status === 503);
  assert.equal(await load("saavn.ts").getPlaylistDetail("missing"), null);
  assert.equal(calls, 2);
});

test("hosted lyrics preserve timed, plain and instrumental outcomes and cache hits", async () => {
  let calls = 0;
  const load = runtime({
    mocks: { "./env": { WEB_BASE_URL: "https://web.example" } },
    fetch: async (url) => {
      calls++;
      const title = new URL(url).searchParams.get("title");
      if (title === "Instrumental") return json({ found: false, reason: "instrumental" });
      const base = {
        found: true,
        matched: { trackName: title, artistName: "Artist", albumName: "Album", duration: 100 },
        drift: true,
      };
      return json(
        title === "Plain"
          ? { ...base, kind: "plain", stanzas: ["Lyrics"] }
          : {
              ...base,
              kind: "timed",
              lines: [
                { start: 0, end: 10, text: "One" },
                { start: 10, end: null, text: "Two" },
              ],
            }
      );
    },
  });
  const lyrics = load("lrclib.ts");
  const seed = { title: "Timed", artist: "Artist", album: "Album", duration: 100 };
  const result = await lyrics.lookupLyrics(seed);
  assert.equal(result.result.body.lines[1].end, Infinity);
  assert.equal(await lyrics.lookupLyrics(seed), result);
  assert.equal(calls, 1);
  assert.equal((await lyrics.lookupLyrics({ ...seed, title: "Plain" })).result.drift, false);
  assert.equal(
    (await lyrics.lookupLyrics({ ...seed, title: "Instrumental" })).reason,
    "instrumental"
  );
});

function socketRuntime(refreshSession = async () => ({ accessToken: "fresh" })) {
  const sockets = [];
  const load = runtime({
    mocks: {
      "./env": { API_URL: "https://account.example" },
      "./api": { getAccessToken: () => "token", refreshSession },
      "socket.io-client": {
        io: (url, options) => {
          const listeners = new Map();
          const any = [];
          const socket = {
            url,
            options,
            connected: false,
            connects: 0,
            on: (event, fn) => listeners.set(event, fn),
            onAny: (fn) => any.push(fn),
            connect() {
              this.connects++;
            },
            close() {
              this.connected = false;
            },
            receive(event, payload) {
              listeners.get(event)?.(payload);
              any.forEach((fn) => fn(event, payload));
            },
          };
          sockets.push(socket);
          return socket;
        },
      },
    },
  });
  return { api: load("socket.ts"), sockets };
}

test("socket subscriptions deliver once, unsubscribe cleanly and survive reconnect", () => {
  const { api, sockets } = socketRuntime();
  let before = 0;
  let after = 0;
  const off = api.onCommunityEvent("library:changed", () => before++);
  api.connectCommunity();
  api.onCommunityEvent("library:changed", () => after++);
  sockets[0].receive("library:changed", {});
  assert.equal(before, 1);
  assert.equal(after, 1);
  off();
  sockets[0].receive("library:changed", {});
  assert.equal(before, 1);
  assert.equal(after, 2);
  api.disconnectCommunity();
  api.connectCommunity();
  sockets[1].receive("library:changed", {});
  assert.equal(after, 3);
  assert.equal(sockets[1].options.transports, undefined);
});

test("rejected socket auth refreshes before reconnecting, but logout cancels recovery", async () => {
  let resolve;
  const { api, sockets } = socketRuntime(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  api.connectCommunity();
  sockets[0].receive("connect_error", new Error("Unauthorized"));
  assert.equal(sockets[0].connects, 0);
  resolve({ accessToken: "fresh" });
  await Promise.resolve();
  assert.equal(sockets[0].connects, 1);
  sockets[0].receive("connect_error", new Error("Unauthorized"));
  api.disconnectCommunity();
  resolve({ accessToken: "fresh" });
  await Promise.resolve();
  assert.equal(sockets[0].connects, 1);
});

test("an unsubscribed status listener does not run in a queued microtask", async () => {
  const { api } = socketRuntime();
  let calls = 0;
  const off = api.onCommunityStatus(() => calls++);
  off();
  await Promise.resolve();
  assert.equal(calls, 0);
});
