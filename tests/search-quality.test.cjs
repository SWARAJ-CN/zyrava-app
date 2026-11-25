/* global __dirname */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

function runtime(mocks = {}, fetch) {
  const modules = new Map();
  const base = path.resolve(__dirname, "../src");
  function load(file) {
    const filename = path.resolve(base, file);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    const localRequire = (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), name + ".ts"));
      if (name.startsWith("@/")) return load(name.slice(2) + ".ts");
      return require(name);
    };
    new Function("module", "exports", "require", "fetch", "setTimeout", code)(
      module,
      module.exports,
      localRequire,
      fetch,
      (...args) => {
        const timer = setTimeout(...args);
        timer.unref();
        return timer;
      }
    );
    return module.exports;
  }
  return load;
}
const song = (
  id,
  title = "The Child In Us",
  artist = "Enigma",
  album = "Le Roi Est Mort, Vive Le Roi!"
) => ({
  id,
  title,
  artist,
  album,
  year: "1996",
  language: "English",
  duration: 305,
  image: "",
  imageLarge: "",
  streamUrl: "https://example.test/song.mp3",
  pageUrl: "",
});
const original = song("original");
const cover = song("cover", "The Child In Us (Enigma)", "Relaxing Music", "Meditation and Cello");
const instrumental = song("instrumental", "The Child In Us (Instrumental)");
const remix = song("remix", "The Child In Us (Remix)");
const rank = runtime()("lib/search-ranking.ts");

for (const query of [
  "The Child in Us by Enigma",
  "The Child in Us by engima",
  "The Child in Us Enigma",
  "Enigma The Child In Us",
  "The Child in Us",
]) {
  test(`original metadata outranks instrumental/remix/artist-in-title covers: ${query}`, () => {
    assert.equal(
      rank.rankSearchResults([cover, instrumental, remix, original], query)[0].id,
      "original"
    );
  });
}
test("explicit remix/instrumental requests remain preferred", () => {
  for (const [suffix, wanted] of [
    ["remix", "remix"],
    ["instrumental", "instrumental"],
  ]) {
    assert.equal(
      rank.rankSearchResults(
        [original, instrumental, remix],
        `The Child in Us ${suffix} by Enigma`
      )[0].id,
      wanted
    );
  }
});
test("short words use token matches, accents normalize, and by inside a title remains usable", () => {
  assert.equal(rank.searchText("Beyoncé — HALO"), "beyonce halo");
  assert.equal(rank.searchText("മലരേ"), "മലരേ".normalize("NFKD"));
  assert.equal(rank.parseSongQuery("Stand by Me").artist, "");
  assert.equal(rank.parseSongQuery("Hello by Adele").artist, "adele");
  assert.equal(
    rank.rankSearchResults([song("bad", "Within Us"), original], "The Child in Us")[0].id,
    "original"
  );
});
test("typed searches do not demote the third matching song to diversify artists", () => {
  const { rankSongs } = runtime({
    "@/components/features/music/filters": {
      matchesRegions: () => false,
      matchesVibe: () => false,
    },
  })("lib/recommend.ts");
  const songs = [song("1"), song("2"), song("3"), cover];
  assert.deepEqual(
    rankSongs(songs, { query: "The Child in Us by Enigma" }).map((s) => s.id),
    ["1", "2", "3", "cover"]
  );
});

function musicRuntime(hosted, fetch) {
  return runtime(
    {
      "./env": { MUSIC_API_BASES: ["https://mirror.example/api"] },
      "./des": { decryptMediaUrl: () => "https://example.test/play.mp3" },
      "./music-server": {
        fetchMusicRoute: hosted,
        musicInt: (n, min, max, fallback) =>
          Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback,
        MusicServerError: class extends Error {},
      },
    },
    fetch
  )("lib/saavn.ts");
}
test("production hosted results receive the same ranking and shared cache as suggestions", async () => {
  let requests = 0;
  const music = musicRuntime(async () => {
    requests++;
    return { songs: [cover, instrumental, original, remix], total: 4 };
  });
  const [suggestions, full] = await Promise.all([
    music.searchSongMatches("The Child in Us by engima", 6),
    music.searchSongMatches("The Child in Us by engima", 10),
  ]);
  assert.equal(requests, 1);
  assert.equal(suggestions.songs[0].id, "original");
  assert.equal(full.songs[0].id, "original");
  assert.ok(
    full.songs.some((s) => s.id === "instrumental"),
    "dedupe must preserve distinct versions even at equal duration"
  );
});
test("an inadequate hosted result recovers the requested recording through title lookup", async () => {
  const urls = [];
  const music = musicRuntime(
    async () => ({ songs: [cover], total: 1 }),
    async (url) => {
      urls.push(new URL(url));
      if (String(url).includes("jiosaavn"))
        return new Response(
          JSON.stringify({
            total: 1,
            results: [
              {
                id: "recovered",
                title: original.title,
                image: "",
                more_info: {
                  album: original.album,
                  duration: "305",
                  encrypted_media_url: "encrypted",
                  artistMap: { primary_artists: [{ name: "Enigma" }] },
                },
              },
            ],
          })
        );
      return new Response(JSON.stringify({ data: { results: [], total: 0 } }));
    }
  );
  const result = await music.searchSongMatches("The Child in Us by engima", 6);
  assert.equal(result.songs[0].id, "recovered");
  assert.ok(urls.some((url) => url.searchParams.get("q") === "the child in us"));
});
test("pagination fills deduplicated windows without dropping or repeating songs", async () => {
  const pages = [];
  const music = musicRuntime(async (route) => {
    const page = Number(new URL("https://example.test/" + route).searchParams.get("page"));
    pages.push(page);
    const unique = Array.from({ length: 10 }, (_, i) =>
      song(`${page}-${i}`, `Track ${page}-${i}`, "Artist")
    );
    return {
      songs: unique.flatMap((item) => [item, { ...item, id: "copy-" + item.id }]),
      total: 60,
    };
  });
  const first = await music.searchSongMatches("Artist", 10, 1);
  const second = await music.searchSongMatches("Artist", 10, 2);
  assert.equal(first.songs.length, 10);
  assert.equal(second.songs.length, 10);
  assert.equal(new Set([...first.songs, ...second.songs].map((s) => s.id)).size, 20);
  assert.deepEqual(pages, [1, 2]);
  assert.equal(second.total, 20);
});

test("implicit artist matching tolerates a typo and multiple credited artists", () => {
  const credited = song("credited", "The Child In Us", "Enigma, Michael Cretu");
  assert.equal(
    rank.rankSearchResults([cover, instrumental, credited], "The Child in Us engima")[0].id,
    "credited"
  );
});

test("direct mirrors and hosted searches return the same best match", async () => {
  const rows = [cover, instrumental, remix, original];
  const music = musicRuntime(
    async () => undefined,
    async () =>
      new Response(
        JSON.stringify({
          data: {
            total: rows.length,
            results: rows.map((s) => ({
              id: s.id,
              name: s.title,
              primaryArtists: s.artist,
              album: { name: s.album },
              duration: s.duration,
              downloadUrl: [{ quality: "320kbps", url: s.streamUrl }],
            })),
          },
        })
      )
  );
  assert.equal(
    (await music.searchSongMatches("The Child in Us by Enigma", 6)).songs[0].id,
    "original"
  );
});

test("a mirror HTTP 403 can use the public direct fallback", async () => {
  let directCalls = 0;
  const music = musicRuntime(
    async () => undefined,
    async (url) => {
      if (String(url).includes("mirror.example")) return new Response("denied", { status: 403 });
      directCalls++;
      return new Response(
        JSON.stringify({
          total: 1,
          results: [
            {
              id: "fallback",
              title: original.title,
              more_info: {
                album: original.album,
                duration: "305",
                encrypted_media_url: "encrypted",
                artistMap: { primary_artists: [{ name: "Enigma" }] },
              },
            },
          ],
        })
      );
    }
  );
  assert.equal(
    (await music.searchSongMatches("The Child in Us by Enigma", 6)).songs[0].id,
    "fallback"
  );
  assert.equal(directCalls, 1);
});

test("a failed later search page reports an error instead of pretending there are no matches", async () => {
  const music = musicRuntime(async (route) => {
    const page = Number(new URL("https://example.test/" + route).searchParams.get("page"));
    if (page > 1) throw new Error("page unavailable");
    return {
      songs: Array.from({ length: 10 }, (_, i) => song(String(i), `Track ${i}`, "Artist")),
      total: 60,
    };
  });
  await music.searchSongMatches("Artist", 10, 1);
  await assert.rejects(music.searchSongMatches("Artist", 10, 2), /page unavailable/);
});

test("an instrumental artist name is not treated as an exact original match", () => {
  const hidden = song("hidden", original.title, "Instrumental Love Songs");
  assert.equal(rank.isStrongSongMatch(hidden, "The Child In Us"), false);
  assert.equal(rank.rankSearchResults([hidden, original], "The Child In Us")[0].id, "original");
  const variation = song("variation", "The Child In Us (The Dusted Variation)");
  assert.equal(rank.isStrongSongMatch(variation, "The Child In Us Enigma"), false);
  assert.equal(
    rank.rankSearchResults([variation, original], "The Child In Us Enigma")[0].id,
    "original"
  );
  const music = musicRuntime(async () => undefined);
  assert.equal(music.dedupeSongs([variation, original]).length, 2);
});

test("short-title recovery preserves the artist query and stays on the recovered source across pages", async () => {
  const routes = [],
    directPages = [];
  const hello = song("hello", "Hello", "Adele");
  const music = musicRuntime(
    async (route) => {
      routes.push(route);
      return { songs: [song("wrong", "Hello", "Instrumental Love Songs")], total: 1 };
    },
    async (url) => {
      const parsed = new URL(url);
      if (!String(url).includes("jiosaavn"))
        return new Response(JSON.stringify({ data: { results: [], total: 0 } }));
      directPages.push(Number(parsed.searchParams.get("p")));
      assert.equal(parsed.searchParams.get("q"), "hello");
      const page = Number(parsed.searchParams.get("p"));
      return new Response(
        JSON.stringify({
          total: 60,
          results: Array.from({ length: 30 }, (_, index) => ({
            id: `${page}-${index}`,
            title: page === 1 && index === 0 ? hello.title : `Other ${page}-${index}`,
            more_info: {
              album: "25",
              duration: "300",
              encrypted_media_url: "encrypted",
              artistMap: { primary_artists: [{ name: "Adele" }] },
            },
          })),
        })
      );
    }
  );
  const first = await music.searchSongMatches("Hello by Adele", 10, 1);
  assert.equal(first.songs[0].title, "Hello");
  assert.equal(first.total, 60, "use recovered catalogue total, not the weak mirror's total");
  assert.equal(
    new URL("https://example.test/" + routes[0]).searchParams.get("q"),
    "Hello by Adele"
  );
  const fourth = await music.searchSongMatches("Hello by Adele", 10, 4);
  assert.ok(fourth.songs.every((s) => s.id.startsWith("2-")));
  assert.deepEqual(directPages, [1, 2]);
  assert.equal(routes.length, 1, "later pages stay on the selected recovery source");
});

test('Mix chart leaders keep ranking and rotate languages on mobile', () => {
  const { interleaveCharts } = runtime({ '@/lib/saavn': {
    dedupeSongs: songs => [...new Map(songs.map(song => [song.id, song])).values()],
  } })('lib/trending-mix.ts');
  const first = song('en1', 'English hit');
  assert.deepEqual(interleaveCharts([
    [first, song('en2', 'English second')],
    [song('hi1', 'Hindi hit'), first],
  ]).map(song => song.id), ['en1', 'hi1', 'en2']);
});
