/** Google with a documented MyMemory fallback when the song language is known. */
const ENDPOINT = "https://translate.googleapis.com/translate_a/single";
export const LYRIC_LANGUAGES = [
  ["en", "English"],
  ["hi", "Hindi"],
  ["ml", "Malayalam"],
  ["ta", "Tamil"],
  ["te", "Telugu"],
  ["kn", "Kannada"],
  ["bn", "Bengali"],
  ["mr", "Marathi"],
  ["gu", "Gujarati"],
  ["pa", "Punjabi"],
  ["ur", "Urdu"],
  ["ar", "Arabic"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["pt", "Portuguese"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh-CN", "Chinese"],
] as const;
export type LyricLanguage = (typeof LYRIC_LANGUAGES)[number][0];

const FALLBACK_ENDPOINT = "https://api.mymemory.translated.net/get";
const cache = new Map<string, { text: string; at: number }>();
const TTL = 24 * 60 * 60 * 1000;
let googleRetryAt = 0;

function sourceCode(language?: string): string | undefined {
  const value = language?.trim().toLowerCase();
  return LYRIC_LANGUAGES.find(
    ([code, name]) => code.toLowerCase() === value || name.toLowerCase() === value
  )?.[0];
}

async function requestJson(url: string, signal: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (signal.aborted) throw new Error("Translation cancelled");
    if (!response.ok) {
      if (response.status === 429 && url.startsWith(ENDPOINT)) googleRetryAt = Date.now() + 60000;
      throw new Error(
        response.status === 429
          ? "Translation service is busy. Please try again later."
          : "Translation service unavailable. Please try again."
      );
    }
    try {
      return await response.json();
    } catch {
      throw new Error("Translation service returned an invalid response. Please try again.");
    }
  } catch (error) {
    if (signal.aborted) throw new Error("Translation cancelled");
    if (timedOut) throw new Error("Translation timed out. Check your connection and retry.");
    if (error instanceof TypeError)
      throw new Error("Cannot reach the translation service. Check your connection.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}

async function google(text: string, language: LyricLanguage, signal: AbortSignal): Promise<string> {
  const params = new URLSearchParams({ client: "gtx", sl: "auto", tl: language, dt: "t", q: text });
  const payload = await requestJson(`${ENDPOINT}?${params}`, signal);
  const chunks: unknown = Array.isArray(payload) ? payload[0] : null;
  if (!Array.isArray(chunks) || !chunks.length) throw new Error("Invalid translation response.");
  const translated = chunks
    .map((part: unknown) => {
      if (!Array.isArray(part) || typeof part[0] !== "string")
        throw new Error("Invalid translation response.");
      return part[0];
    })
    .join("")
    .trim();
  if (!translated) throw new Error("The translation service returned no text.");
  return translated;
}

async function fallback(
  text: string,
  from: string,
  to: LyricLanguage,
  signal: AbortSignal
): Promise<string> {
  if (from === to) return text;
  // MyMemory accepts at most 500 UTF-8 bytes. Split long lines at word boundaries.
  const segments: string[] = [];
  let segment = "";
  let size = 0;
  const byteLength = (value: string) =>
    encodeURIComponent(value).replace(/%[0-9A-F]{2}|./g, "x").length;
  for (const word of text.split(/(\s+)/)) {
    const wordSize = byteLength(word);
    if (size && size + wordSize > 500) {
      if (segment.trim()) segments.push(segment.trim());
      segment = "";
      size = 0;
    }
    if (wordSize <= 500) {
      segment += word;
      size += wordSize;
      continue;
    }
    // A single word can exceed the limit (e.g. text without spaces).
    for (const char of word) {
      const bytes = byteLength(char);
      if (size + bytes > 500) {
        segments.push(segment);
        segment = "";
        size = 0;
      }
      segment += char;
      size += bytes;
    }
  }
  if (segment.trim()) segments.push(segment.trim());
  const translations: string[] = [];
  for (const part of segments) {
    if (signal.aborted) throw new Error("Translation cancelled");
    const params = new URLSearchParams({ q: part, langpair: `${from}|${to}`, mt: "1" });
    const data = (await requestJson(`${FALLBACK_ENDPOINT}?${params}`, signal)) as {
      responseStatus?: number | string;
      quotaFinished?: boolean;
      responseData?: { translatedText?: string };
      matches?: { segment?: string; translation?: string; id?: number | string }[];
    } | null;
    if (data?.quotaFinished || Number(data?.responseStatus) === 429)
      throw new Error("Today's free translation limit has been reached. Please try again later.");
    if (Number(data?.responseStatus) !== 200 || !data?.responseData?.translatedText?.trim())
      throw new Error("Translation is unavailable for this language pair. Please try again later.");
    // Translation memories can return a similar, different sentence. Never use that as a lyric.
    const exact = data.matches?.filter(
      (match) => match.segment?.trim() === part.trim() && match.translation?.trim()
    );
    const match = exact?.find((match) => Number(match.id) === 0) ?? exact?.[0];
    if (!match?.translation)
      throw new Error("No matching translation was returned for this lyric.");
    translations.push(match.translation.trim());
  }
  return translations.join(" ");
}

/** Preserve row order and timestamps; never attach a shifted translation to a lyric. */
export async function translateLyricLines(
  texts: string[],
  language: LyricLanguage,
  signal: AbortSignal,
  sourceLanguage?: string
): Promise<string[]> {
  const from = sourceCode(sourceLanguage);
  const cacheKey = (text: string) => `${from ?? "auto"}|${language}|${text}`;
  const results = new Map<string, string>();
  const wanted: string[] = [];
  for (const text of new Set(texts.map((text) => text.trim()))) {
    if (!text) {
      results.set(text, "");
      continue;
    }
    const hit = cache.get(cacheKey(text));
    if (hit && Date.now() - hit.at < TTL) results.set(text, hit.text);
    else wanted.push(text);
  }
  const batches: string[][] = [];
  let batch: string[] = [];
  let size = 0;
  for (const text of wanted) {
    const length = encodeURIComponent(text).length;
    if (batch.length && (batch.length >= 8 || size + length > 1800)) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(text);
    size += length + 3;
  }
  if (batch.length) batches.push(batch);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) controller.abort();
  let useFallback = !!from && Date.now() < googleRetryAt;
  let cursor = 0;
  const remember = (text: string, translated: string) => {
    if (controller.signal.aborted) throw new Error("Translation cancelled");
    results.set(text, translated);
    cache.set(cacheKey(text), { text: translated, at: Date.now() });
    while (cache.size > 500) cache.delete(cache.keys().next().value!);
  };
  const worker = async () => {
    while (cursor < batches.length) {
      if (controller.signal.aborted) throw new Error("Translation cancelled");
      const source = batches[cursor++];
      if (!useFallback) {
        try {
          const translated = (await google(source.join("\n"), language, controller.signal))
            .split(/\r?\n/)
            .map((line) => line.trim());
          if (translated.length === source.length && translated.every(Boolean)) {
            source.forEach((text, index) => remember(text, translated[index]));
            continue;
          }
          // Some providers merge line breaks. Retry each original independently.
          for (const text of source)
            remember(text, await google(text, language, controller.signal));
          continue;
        } catch (error) {
          if (controller.signal.aborted || !from) throw error;
          useFallback = true;
        }
      }
      for (const text of source) {
        if (!results.has(text))
          remember(text, await fallback(text, from!, language, controller.signal));
      }
    }
  };
  try {
    await Promise.all([worker(), worker()]);
    if (signal.aborted) throw new Error("Translation cancelled");
    return texts.map((text) => results.get(text.trim()) ?? "");
  } finally {
    cancel();
    signal.removeEventListener("abort", cancel);
  }
}
