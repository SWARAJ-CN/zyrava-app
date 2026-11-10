/**
 * Tiny typed event bus replacing the web app's CustomEvent fan-out
 * (music:theme-change, amare:locale, music:voice-language, community
 * connect/disconnect status, …). Event names are preserved verbatim.
 */
type Handler = (detail: unknown) => void;

const handlers = new Map<string, Set<Handler>>();

export function on(event: string, handler: Handler): () => void {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(handler);
  return () => {
    set?.delete(handler);
  };
}

export function emit(event: string, detail?: unknown): void {
  const set = handlers.get(event);
  if (!set) return;
  for (const handler of [...set]) handler(detail);
}
