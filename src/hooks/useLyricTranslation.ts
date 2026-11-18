import { useEffect, useState } from "react";
import type { LyricsBody } from "@/lib/lyrics";
import { translateLyricLines, type LyricLanguage } from "@/lib/lyric-translation";

export function useLyricTranslation(
  body: LyricsBody | null,
  language: LyricLanguage | null,
  sourceLanguage?: string
) {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{
    body: LyricsBody;
    language: LyricLanguage;
    attempt: number;
    sourceLanguage?: string;
    error?: string;
    status: "ready" | "error";
    rows?: string[];
  } | null>(null);
  useEffect(() => {
    if (!body || !language) return;
    const controller = new AbortController();
    const groups =
      body.kind === "timed"
        ? body.lines.map((line) => line.text.split(/\r?\n/))
        : body.stanzas.map((stanza) => stanza.split(/\r?\n/));
    void translateLyricLines(groups.flat(), language, controller.signal, sourceLanguage)
      .then((lines) => {
        if (controller.signal.aborted) return;
        let cursor = 0;
        const rows = groups.map((group) => {
          const text = lines.slice(cursor, cursor + group.length).join("\n");
          cursor += group.length;
          return text;
        });
        setSettled({ body, language, attempt, sourceLanguage, status: "ready", rows });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setSettled({
            body,
            language,
            attempt,
            sourceLanguage,
            status: "error",
            error:
              error instanceof Error ? error.message : "Translation unavailable. Please try again.",
          });
      });
    return () => controller.abort();
  }, [body, language, attempt, sourceLanguage]);
  const current =
    settled?.body === body &&
    settled.language === language &&
    settled.attempt === attempt &&
    settled.sourceLanguage === sourceLanguage
      ? settled
      : null;
  return {
    status: !body || !language ? "off" : (current?.status ?? "loading"),
    rows: current?.rows,
    error: current?.error,
    retry: () => setAttempt((value) => value + 1),
  };
}
