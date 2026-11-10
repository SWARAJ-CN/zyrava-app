/**
 * JioSaavn `encrypted_media_url` decryption — the web app uses node-forge's
 * DES-ECB here; on device we run the identical primitive through crypto-js
 * (pure JS, no OpenSSL legacy provider, no Buffer polyfills).
 */
import CryptoJS from "crypto-js";

const JIOSAAVN_KEY = "38346591";

export function decryptMediaUrl(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try {
    const key = CryptoJS.enc.Utf8.parse(JIOSAAVN_KEY);
    const decrypted = CryptoJS.DES.decrypt(
      CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(value) }),
      key,
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
    );
    return decrypted.toString(CryptoJS.enc.Latin1);
  } catch {
    return "";
  }
}
