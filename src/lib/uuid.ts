/** `crypto.randomUUID()` with the web app's own fallback shape. */
export function randomUUID(): string {
  try {
    // Hermes on RN 0.88 exposes a Web Crypto-compatible global.
    const cryptoGlobal = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (cryptoGlobal?.randomUUID) return cryptoGlobal.randomUUID();
  } catch {
    /* fall through to the deterministic fallback below */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
